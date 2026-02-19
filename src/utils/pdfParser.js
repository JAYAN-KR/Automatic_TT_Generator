import * as pdfjs from 'pdfjs-dist';

// Use CDN for worker to avoid local Vite serving issues
pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';

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
            // AND Class Teacher Period headers like "CLASS TEACHER", "CTT", "CT"
            return (/^0?[1-9]$/.test(val)) || (/^P0?[1-9]$/i.test(val)) || (/^Period\s?0?[1-9]$/i.test(val)) || (/^\(?[1-9]\)?$/.test(val)) ||
                (/CLASS\s?TEACHER/i.test(val)) || (/^CTT$/i.test(val)) || (/^CT$/i.test(val));
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
                    // Increased tolerance from 15 to 25 to catch subjects below class text
                    if (dist < 25 && dist < minDistY) { minDistY = dist; bestDay = d.str.toUpperCase().slice(0, 3); }
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
                    const sortedAllPeriods = [...headerRow].sort((a, b) => a.x - b.x);

                    const xGroups = [];
                    sortedAllPeriods.forEach(p => {
                        let added = false;
                        for (let group of xGroups) {
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

                    let relevantPeriods = null;
                    for (let group of xGroups) {
                        const minX = Math.min(...group.map(p => p.x));
                        const maxX = Math.max(...group.map(p => p.x + p.width));
                        if (item.x >= minX - 50 && item.x <= maxX + 50) {
                            relevantPeriods = group;
                            break;
                        }
                    }

                    if (!relevantPeriods || relevantPeriods.length === 0) {
                        return;
                    }

                    const shift = 0;

                    const sortedPeriods = [...relevantPeriods].sort((a, b) => a.x - b.x);
                    const shiftedPeriods = sortedPeriods.map(p => ({
                        pNum: p.str.replace(/\D/g, ''),
                        x: (p.x + p.width / 2) - shift
                    }));

                    const itemCenter = item.x + (item.width / 2);
                    const itemStart = item.x;
                    const itemEnd = item.x + item.width;

                    const candidates = [];

                    shiftedPeriods.forEach(p => {
                        candidates.push({
                            type: 'single',
                            pNum: p.pNum,
                            x: p.x
                        });
                    });

                    for (let i = 0; i < shiftedPeriods.length - 1; i++) {
                        const cur = shiftedPeriods[i];
                        const nxt = shiftedPeriods[i + 1];
                        const mid = (cur.x + nxt.x) / 2;

                        const crossesLeft = itemStart < (mid - 2);
                        const crossesRight = itemEnd > (mid + 2);

                        if (crossesLeft && crossesRight) {
                            candidates.push({
                                type: 'double',
                                pNum: cur.pNum,
                                nextPNum: nxt.pNum,
                                x: itemCenter,
                                isOverlap: true
                            });
                        }
                    }

                    let bestCandidate = null;
                    let bestScore = Infinity;

                    candidates.forEach(cand => {
                        let score;
                        if (cand.type === 'double' && cand.isOverlap) {
                            score = 0;
                        } else {
                            score = Math.abs(itemCenter - cand.x);
                        }

                        if (score < bestScore) {
                            bestScore = score;
                            bestCandidate = cand;
                        } else if (score === bestScore) {
                            if (cand.type === 'double') {
                                bestCandidate = cand;
                            }
                        }
                    });

                    if (bestCandidate && bestScore > 25) {
                        bestCandidate = null;
                    }

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

            // Helper: Normalize Roman numerals and combined tokens (XI B -> 11B, XIIA -> 12A)
            const normalizeClass = (val) => {
                if (!val) return "";
                const v = val.trim().toUpperCase();
                const romanMap = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8', 'IX': '9', 'X': '10', 'XI': '11', 'XII': '12' };

                // Case 1: "XI B", "XII A" etc.
                const parts = v.split(/\s+/);
                if (parts.length === 2 && romanMap[parts[0]]) {
                    return `${romanMap[parts[0]]}${parts[1]}`;
                }

                // Case 2: "XIB", "XIIA" etc.
                const match = v.match(/^([IVX]+)([A-Z]\d*)$/);
                if (match && romanMap[match[1]]) {
                    return `${romanMap[match[1]]}${match[2]}`;
                }

                // Case 3: "11 B" (space in Arabic)
                if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^[A-Z]$/.test(parts[1])) {
                    return `${parts[0]}${parts[1]}`;
                }

                // Case 4: Already "11B"
                return v.replace(/\s+/g, '');
            };

            // Internal Subject Deduplicator: handles "PHY/CHE LAB PHY LAB,CHE LAB" -> "PHY/CHE LAB"
            const cleanSubject = (val) => {
                if (!val || typeof val !== 'string') return val;
                const topParts = val.split(" / ");
                const finalParts = [];

                topParts.forEach(part => {
                    // Split into significant chunks by spaces or commas
                    const chunks = part.split(/[\s,]+/).filter(c => c.length >= 2);
                    const keptChunks = [];

                    chunks.forEach((chunk, i) => {
                        const up = chunk.toUpperCase();
                        // Check if this chunk is already redundant within the same part
                        const isRedundant = chunks.some((other, j) => {
                            if (i === j) return false;
                            const otherUp = other.toUpperCase();
                            // If otherUp contains this chunk as a major component (e.g. "PHY/CHE" contains "PHY")
                            if (otherUp.includes(up)) {
                                if (otherUp === up) return j < i; // Keep first of identical words
                                // Check if it's a sub-word boundary like PHY in PHY/CHE
                                return otherUp.split(/[^A-Z]/i).includes(up);
                            }
                            return false;
                        });
                        if (!isRedundant) keptChunks.push(chunk);
                    });

                    const cleaned = keptChunks.join(" ");
                    if (cleaned && !finalParts.includes(cleaned)) finalParts.push(cleaned);
                });

                return finalParts.join(" / ");
            };

            // Post-Processing: Clean Class Names and Extract Subjects
            dayRows.forEach(day => {
                Object.keys(schedule[day]).forEach(key => {
                    let val = schedule[day][key];
                    if (val !== "Free") {
                        const parts = val.split(" / ");
                        let keptParts = [];

                        // Regex for numeric classes like "12A", "9C", "10D1"
                        const numericClassRegex = /^(\d+[A-Z]\d*)$/;
                        // Regex for hybrid merged strings like "11C PHY"
                        const hybridRegex = /^(\d+[A-Z])\s+(.+)$/;

                        parts.forEach(p => {
                            // Case 1: Pure Numeric Class
                            if (numericClassRegex.test(p)) {
                                if (!keptParts.includes(p)) keptParts.push(p);
                                return;
                            }

                            // Case 2: Hybrid "Class Subject" merged string
                            const hybridMatch = p.match(hybridRegex);
                            if (hybridMatch) {
                                const cls = hybridMatch[1];
                                const subj = cleanSubject(hybridMatch[2]);
                                if (!keptParts.includes(cls)) keptParts.push(cls);
                                if (!keptParts.includes(subj)) keptParts.push(subj);
                                return;
                            }

                            // Case 3: Roman Numerals or other text (Subject/CC)
                            const currentClassHead = keptParts.find(p => numericClassRegex.test(p));
                            const words = p.split(' ');
                            const cleanWords = words.filter(w => {
                                // Check if this word or word-pair is a redundant representation of current class
                                const normalized = normalizeClass(w);
                                if (normalized && currentClassHead && normalized === currentClassHead) return false;
                                return true;
                            });

                            let cleanP = cleanSubject(cleanWords.join(' ').trim());

                            // Check if the whole part normalizes to an existing class
                            const fullNormalized = normalizeClass(cleanP);
                            if (currentClassHead && fullNormalized === currentClassHead) return;

                            if (cleanP.length > 0 && !keptParts.includes(cleanP)) {
                                keptParts.push(cleanP);
                            }
                        });

                        // Structured Storage: If we have both classes and other text, store as object
                        if (keptParts.length > 0) {
                            const classes = keptParts.filter(p => numericClassRegex.test(p));
                            const normalizedClasses = classes.map(c => normalizeClass(c));
                            const allOthers = keptParts.filter(p => !numericClassRegex.test(p));

                            // Deduplicate subjects: e.g. ["PHY/CHE LAB", "PHY LAB", "CHE LAB", "XIB"] -> ["PHY/CHE LAB"]
                            const others = allOthers.filter((item, index) => {
                                // 1. Check if the whole item is a class (e.g. "XIB" while classes has "11B")
                                const normalizedItem = normalizeClass(item);
                                if (normalizedClasses.includes(normalizedItem)) return false;

                                // 2. Check tokens for redundancy
                                const tokens = item.split(/[^A-Z]/i).filter(t => t.length >= 2).map(t => t.toUpperCase());
                                if (tokens.length === 0) return true;

                                // Check against other subjects
                                const redundantToOtherSubject = allOthers.some((other, otherIdx) => {
                                    if (index === otherIdx) return false;
                                    const otherTokens = other.split(/[^A-Z]/i).filter(t => t.length >= 2).map(t => t.toUpperCase());
                                    const contained = tokens.every(t => otherTokens.includes(t));
                                    if (contained) {
                                        if (tokens.length === otherTokens.length) return otherIdx < index;
                                        return true;
                                    }
                                    return false;
                                });

                                if (redundantToOtherSubject) return false;

                                // 3. Check if any token matches a normalized class (e.g. item "PHY XIB" and class "11B")
                                const tokenMatchesClass = tokens.some(t => normalizedClasses.includes(normalizeClass(t)));
                                if (tokenMatchesClass && tokens.length === 1) return false; // If it's JUST the class name, remove

                                return true;
                            });

                            if (classes.length > 0 && others.length > 0) {
                                schedule[day][key] = {
                                    class: classes.join(" / "),
                                    subject: others.join(" / ")
                                };
                            } else {
                                schedule[day][key] = keptParts.join(" / ");
                            }
                        }
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
