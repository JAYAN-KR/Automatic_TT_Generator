import * as pdfjs from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function parseTimetablePDF(arrayBuffer) {
    try {
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let allTextItems = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });

            const pageItems = textContent.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: viewport.height - item.transform[5],
                width: item.width,
                height: item.height,
                page: i,
                pageWidth: viewport.width
            })).filter(item => item.str.trim().length > 0);

            // Sort items: Top-to-bottom, then Left-to-right
            pageItems.sort((a, b) => Math.abs(a.y - b.y) < 5 ? a.x - b.x : a.y - b.y);

            // Merge horizontal fragments (e.g., "T" + "eacher" or "8" + "D")
            // CRITICAL: Gap must be very small (1px) to prevent merging adjacent period items
            // like "10E" and "7A" which may be close together but in different periods
            const merged = [];
            pageItems.forEach(item => {
                const last = merged[merged.length - 1];
                if (last && Math.abs(last.y - item.y) < 2 && (item.x - (last.x + last.width)) < 1) {
                    last.str += " " + item.str;
                    last.width = (item.x + item.width) - last.x;
                } else {
                    merged.push({ ...item });
                }
            });
            allTextItems = allTextItems.concat(merged.map(m => ({ ...m, str: m.str.trim() })));

            // DEBUG: Log all extracted items for this page
            console.log(`\n=== PAGE ${i} ITEMS ===`);
            merged.forEach(item => {
                if (!item.str.includes("TEACHER") && !["MON", "TUE", "WED", "THU", "FRI", "SAT"].includes(item.str.toUpperCase())) {
                    console.log(`"${item.str}" at x=${item.x}, width=${item.width}`);
                }
            });
        }
        return processGridData(allTextItems);
    } catch (error) {
        console.error("PDF Parsing Error:", error);
        throw error;
    }
}

function processGridData(items) {
    const finalTimetables = {};
    const dayRows = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

    // 1. Find all Teacher headers
    const headers = items.filter(item =>
        item.str.toUpperCase().includes("TEACHER") &&
        !item.str.toUpperCase().includes("CLASS TEACHER")
    );

    if (headers.length === 0) return {};

    const ownerGroups = new Map(); // Map<Header, Items[]>

    // 2. Assign every item on the page to its most likely Teacher owner
    items.forEach(item => {
        if (headers.includes(item)) return;
        const s = item.str.toUpperCase();
        if (["SCHOOL", "GENERATED", "TIMETABLE", "THE CHOICE"].some(k => s.includes(k))) return;

        // Filter headers on the SAME PAGE
        const candidates = headers.filter(h => h.page === item.page);
        if (candidates.length === 0) return;

        let bestH = null, minScore = Infinity;
        candidates.forEach(h => {
            // dy = item below header (positive means item is LOWER on page)
            const dy = item.y - h.y;
            const dx = Math.abs(item.x - h.x);

            // If item is ABOVE header (dy < -20) (allowing slight header overlap)
            if (dy < -20) return;

            // Scoring: Vertical distance is much more important.
            // Also factor in "Column Logic": items in the same horizontal half are much more likely partners.
            const midX = item.pageWidth / 2;
            const colPenalty = ((h.x < midX) === (item.x < midX)) ? 0 : 5000;

            const score = (Math.abs(dy) * 5) + dx + colPenalty;
            if (score < minScore) {
                minScore = score;
                bestH = h;
            }
        });

        if (bestH) {
            if (!ownerGroups.has(bestH)) ownerGroups.set(bestH, []);
            ownerGroups.get(bestH).push(item);
        }
    });

    // 3. Process each group to fill schedules
    ownerGroups.forEach((groupItems, header) => {
        let cleanName = header.str.replace(/Teacher/gi, '').replace(/:/g, '').trim();
        // Clean noise
        const noise = ["CHOICE SCHOOL", "NADAMA EAST", "TIMETABLE GENERATED"];
        noise.forEach(n => {
            const idx = cleanName.toUpperCase().indexOf(n);
            if (idx !== -1) cleanName = cleanName.substring(0, idx).trim();
        });
        if (cleanName.length < 2) return;

        // Within groupItems, find days and periods
        const dayLabels = groupItems.filter(item => dayRows.includes(item.str.toUpperCase().slice(0, 3)));
        const periodLabels = groupItems.filter(item => {
            const val = item.str.trim();
            // Catch "1", "P1", "Period 1", "01", "(2)"
            // Standard digits 1-9, possibly with 0 prefix or parens
            // Regex: 1-char digit 1-9, or P+digit, or Period+digit.
            return (/^0?[1-9]$/.test(val)) || (/^P0?[1-9]$/i.test(val)) || (/^Period\s?0?[1-9]$/i.test(val)) || (/^\(?[1-9]\)?$/.test(val));
        });

        const schedule = {};
        dayRows.forEach(day => {
            schedule[day] = {};
            for (let i = 1; i <= 9; i++) schedule[day][`Period${i}`] = "Free";
        });

        if (dayLabels.length > 0 && periodLabels.length > 0) {
            groupItems.forEach(item => {
                const s = item.str.toUpperCase();
                if (dayRows.some(d => s === d || s.startsWith(d + " "))) return;
                if (periodLabels.includes(item)) return;
                // Ignore noise, CTT, and bell timings
                if (["BREAK", "SCHOOL", "TEACHER", "CTT", "GENERATED", "CLASS TEACHER"].some(k => s.includes(k))) return;
                // Filter out time ranges (e.g., "8:00 - 8:35", "9:00 - 9:40", "8:35 - 9")
                // more robust regex: digit followed by : or . then digit, OR just looking for tight time-like strings with dash
                if ((/\d{1,2}[:.]\d{2}/.test(s) && /-/.test(s)) || (/-/.test(s) && /\d{1,2}\s*-\s*\d{1,2}/.test(s))) return;

                // Map item to nearest Day (Y)
                let bestDay = null, minDistY = 999;
                dayLabels.forEach(d => {
                    const dist = Math.abs(d.y - item.y);
                    // Tolerance 15
                    if (dist < 15 && dist < minDistY) { minDistY = dist; bestDay = d.str.toUpperCase().slice(0, 3); }
                });

                if (bestDay && periodLabels.length > 0) {

                    // Filter periodLabels to be on the same row (the Header Row)
                    const yGroups = {};
                    periodLabels.forEach(p => {
                        const yKey = Math.round(p.y / 5) * 5; // Cluster by 5px tolerance
                        if (!yGroups[yKey]) yGroups[yKey] = [];
                        yGroups[yKey].push(p);
                    });

                    let bestY = null;
                    let maxCount = 0;
                    Object.keys(yGroups).forEach(y => {
                        const count = yGroups[y].length;
                        // Prefer rows with more numbers (actual header row)
                        if (count > maxCount) {
                            maxCount = count;
                            bestY = y;
                        } else if (count === maxCount) {
                            if (parseFloat(y) < parseFloat(bestY)) bestY = y;
                        }
                    });

                    const headerRow = yGroups[bestY] || periodLabels;

                    // CRITICAL: Filter headerRow to only include period headers that are horizontally near this item
                    // This prevents items from one teacher's schedule bleeding into another teacher's schedule
                    // or items from one day column being assigned to an adjacent day
                    const sortedAllPeriods = [...headerRow].sort((a, b) => a.x - b.x);

                    // Find the range of X values for this day's column by looking at period headers
                    // Group period headers by X proximity (different teacher schedules are ~400px apart)
                    const xGroups = [];
                    sortedAllPeriods.forEach(p => {
                        let added = false;
                        for (let group of xGroups) {
                            // If this period is within 200px of any period in the group, add it
                            if (group.some(g => Math.abs(g.x - p.x) < 200)) {
                                group.push(p);
                                added = true;
                                break;
                            }
                        }
                        if (!added) {
                            xGroups.push([p]);
                        }
                    });

                    // Find which group this item belongs to based on X position
                    let relevantPeriods = null;
                    for (let group of xGroups) {
                        const minX = Math.min(...group.map(p => p.x));
                        const maxX = Math.max(...group.map(p => p.x + p.width));
                        // Check if item is within this group's X range (with some tolerance)
                        if (item.x >= minX - 50 && item.x <= maxX + 50) {
                            relevantPeriods = group;
                            break;
                        }
                    }

                    // If item doesn't fall within any period header group, skip it
                    if (!relevantPeriods || relevantPeriods.length === 0) {
                        return;
                    }

                    // CONSOLIDATED LOGIC: Width-Based Unified Calibration (High Threshold) + Overlap Bonus

                    // Disable calibration - let each item find its nearest period independently
                    // This handles PDFs with inconsistent spacing where items can't all use same shift
                    const shift = 0; // calibrateHeaders(groupItems, headerRow);

                    // 2. Prepare Candidates using SHIFTED Grid for ALL
                    const sortedPeriods = [...relevantPeriods].sort((a, b) => a.x - b.x);
                    const shiftedPeriods = sortedPeriods.map(p => ({
                        pNum: p.str.replace(/\D/g, ''),
                        x: (p.x + p.width / 2) - shift
                    }));

                    const itemCenter = item.x + (item.width / 2);
                    const itemStart = item.x;
                    const itemEnd = item.x + item.width;

                    const candidates = [];

                    // Add Single Period Centers (Shifted)
                    shiftedPeriods.forEach(p => {
                        candidates.push({
                            type: 'single',
                            pNum: p.pNum,
                            x: p.x
                        });
                    });


                    // Add Double Period Boundaries (Shifted)
                    for (let i = 0; i < shiftedPeriods.length - 1; i++) {
                        const cur = shiftedPeriods[i];
                        const nxt = shiftedPeriods[i + 1];
                        const mid = (cur.x + nxt.x) / 2; // Boundary between Shifted Centers

                        // STRICT OVERLAP CHECK - Item must SIGNIFICANTLY cross the boundary
                        // Not just touch it - must extend at least 2px on each side
                        // Reduced from 10px to 2px to allow narrow items (width ~10-15px like "8G") 
                        // to be detected as double if they span the line
                        const crossesLeft = itemStart < (mid - 2);
                        const crossesRight = itemEnd > (mid + 2);

                        if (crossesLeft && crossesRight) {
                            candidates.push({
                                type: 'double',
                                pNum: cur.pNum,
                                nextPNum: nxt.pNum,
                                x: itemCenter, // Perfect Match for scoring purposes
                                isOverlap: true
                            });
                        }
                    }

                    // 3. Scoring
                    let bestCandidate = null;
                    let bestScore = Infinity;

                    candidates.forEach(cand => {
                        let score;
                        // If physically overlapping boundary, Score is 0 (Absolute Priority)
                        if (cand.type === 'double' && cand.isOverlap) {
                            score = 0;
                        } else {
                            score = Math.abs(itemCenter - cand.x);
                        }

                        if (score < bestScore) {
                            bestScore = score;
                            bestCandidate = cand;
                        } else if (score === bestScore) {
                            // Tie-breaker: Prefer Double if Priority Match (score 0)
                            if (cand.type === 'double') {
                                bestCandidate = cand;
                            }
                        }
                    });

                    // Distance Threshold: If the best match is too far away, ignore it.
                    // This handles margin items (like "10E" at x=50 for P1 at x=85, distance 35)
                    // Valid threshold approx 25px (Period width ~28px)
                    if (bestCandidate && bestScore > 25) {
                        bestCandidate = null;
                    }

                    // 4. Assign
                    const targets = [];
                    if (bestCandidate) {
                        if (bestCandidate.type === 'single') {
                            targets.push(bestCandidate.pNum);
                        } else {
                            targets.push(bestCandidate.pNum);
                            targets.push(bestCandidate.nextPNum);
                        }
                    }

                    targets.forEach(pNum => {
                        if (pNum >= "1" && pNum <= "9") {
                            const key = `Period${pNum}`;
                            if (schedule[bestDay][key] === "Free") {
                                schedule[bestDay][key] = item.str;
                            } else if (!schedule[bestDay][key].includes(item.str)) {
                                schedule[bestDay][key] += " / " + item.str;
                            }
                        }
                    });
                }
            });

            // Post-Processing: Clean Class Names
            dayRows.forEach(day => {
                Object.keys(schedule[day]).forEach(key => {
                    let val = schedule[day][key];
                    if (val !== "Free") {
                        const parts = val.split(" / ");
                        let keptParts = [];
                        const numericClasses = parts.filter(p => /^\d+[A-Z]$/.test(p) || /^\d+[A-Z]\d*$/.test(p));

                        parts.forEach(p => {
                            if (numericClasses.includes(p)) {
                                if (!keptParts.includes(p)) keptParts.push(p);
                                return;
                            }
                            const romanMap = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8', 'IX': '9', 'X': '10', 'XI': '11', 'XII': '12' };
                            const romanMatch = p.match(/^([IVX]+)([A-Z])$/);
                            if (romanMatch) {
                                const [_, rNum, rLet] = romanMatch;
                                const arabNum = romanMap[rNum];
                                if (arabNum && numericClasses.some(nc => nc === `${arabNum}${rLet}`)) return;
                            }
                            const words = p.split(' ');
                            const cleanWords = words.filter(w => {
                                const wMatch = w.match(/^([IVX]+)([A-Z])$/);
                                if (wMatch) {
                                    const [_, rNum, rLet] = wMatch;
                                    const arabNum = romanMap[rNum];
                                    if (arabNum && numericClasses.some(nc => nc === `${arabNum}${rLet}`)) return false;
                                }
                                return true;
                            });
                            const cleanP = cleanWords.join(' ').trim();
                            if (cleanP.length > 0 && !keptParts.includes(cleanP) && !numericClasses.includes(cleanP)) {
                                keptParts.push(cleanP);
                            }
                        });
                        schedule[day][key] = keptParts.join(" / ");
                    }
                });
            });
        }

        finalTimetables[cleanName] = schedule;
    });

    return finalTimetables;
}

// Function to find the global X-shift that best aligns content to headers
function calibrateHeaders(items, headers) {
    // 1. Calculate Original Midpoints
    const sortedHeaders = [...headers].sort((a, b) => a.x - b.x);
    const midpoints = [];
    for (let i = 0; i < sortedHeaders.length - 1; i++) {
        const h1 = sortedHeaders[i];
        const h2 = sortedHeaders[i + 1];
        midpoints.push({
            val: (h1.x + h1.width / 2 + h2.x + h2.width / 2) / 2,
            type: 'boundary'
        });
    }
    const headerCenters = sortedHeaders.map(h => ({
        val: h.x + h.width / 2,
        type: 'header'
    }));

    const relevantItems = items.filter(i =>
        !headers.includes(i) &&
        !["MON", "TUE", "WED", "THU", "FRI", "SAT"].some(d => i.str.toUpperCase().includes(d)) &&
        !["BREAK", "LUNCH"].some(k => i.str.toUpperCase().includes(k))
    );

    // Use ALL relevant items, but treat them differently based on width
    const validItems = relevantItems;

    if (validItems.length === 0) return 0;

    let bestShift = 0;
    let minTotalDist = Infinity;

    // Search Range: -300 to +300 px shift to handle large misalignments
    for (let s = -300; s <= 300; s += 5) {
        let totalDist = 0;
        let matchCount = 0;

        validItems.forEach(item => {
            const itemCenter = item.x + item.width / 2;
            const itemWidth = item.width;

            let localMin = Infinity;

            // WIDTH HEURISTIC:
            // Wide items (>80) align with BOUNDARIES (Verified 80px helps avoid catching 50px single items)
            // Narrow items (<=80) align with HEADERS

            if (itemWidth > 80) {
                midpoints.forEach(mp => {
                    const shiftedMP = mp.val - s;
                    const d = Math.abs(itemCenter - shiftedMP);
                    if (d < localMin) localMin = d;
                });
            } else {
                headerCenters.forEach(hc => {
                    const shiftedHC = hc.val - s;
                    const d = Math.abs(itemCenter - shiftedHC);
                    if (d < localMin) localMin = d;
                });
            }

            // Relaxed THRESHOLD 100
            if (localMin < 100) {
                totalDist += localMin;
                matchCount++;
            }
        });

        if (matchCount > 0) {
            const avgError = totalDist / matchCount;
            // No Bias
            const score = avgError + (validItems.length - matchCount) * 100;

            if (score < minTotalDist) {
                minTotalDist = score;
                bestShift = s;
            }
        }
    }
    return bestShift;
}
