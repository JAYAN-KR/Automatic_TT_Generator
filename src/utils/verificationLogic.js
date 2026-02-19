
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the worker - Use local file for consistency
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Verifies the integrity of the extracted timetable data against a fresh PDF upload using SCOPED checking.
 * @param {ArrayBuffer} pdfArrayBuffer - The raw PDF data
 * @param {Object} currentTimetables - The JSON object currently in localStorage
 * @returns {Promise<Object>} Verification Report
 */
export async function verifyTimetableData(pdfArrayBuffer, currentTimetables) {
    const report = {
        valid: true,
        issues: [],
        warnings: [],
        stats: {
            teachersFoundInJson: 0,
            teachersConfirmedInPdf: 0,
            suspiciousEntries: 0,
            scopedMismatches: 0
        },
        details: [] // Detailed per-teacher reports
    };

    try {
        // 1. Extract & Segment PDF Text
        const teacherBlocks = await extractTeacherBlocks(pdfArrayBuffer);

        // 2. Normalize and Map Blocks for Verification
        // 2. Normalize and Map Blocks for Verification
        // Map: TeacherName (from JSON) -> Set(WordsInBlock)
        const blockMap = new Map();
        const knownTeachers = Object.keys(currentTimetables);

        teacherBlocks.forEach(block => {
            // 2a. Identify which teacher owns this block
            // We search for the Known Teacher Name in the Block's Header + Start of Content
            const blockSignature = normalizeName(block.header + " " + block.content.substring(0, 50));

            let bestTeacher = null;
            let maxLen = 0;

            for (const tName of knownTeachers) {
                const normT = normalizeName(tName);
                if (normT.length < 3) continue;

                // Check for name presence
                if (blockSignature.includes(normT)) {
                    // Pick the specific match (Longest) to avoid "Ann" matching "Anna"
                    if (normT.length > maxLen) {
                        maxLen = normT.length;
                        bestTeacher = tName;
                    }
                }
            }

            // Fallback: If no known teacher found, maybe relying on header is still useful for debugging or unlisted teachers?
            // For verification, we only care about teachers IN the JSON, so if we can't find a JSON name, we ignore the block (it might be a page header or junk).

            if (bestTeacher) {
                const contentWords = new Set(
                    block.content.toUpperCase()
                        .replace(/[^A-Z0-9\s]/g, ' ')
                        .split(/\s+/)
                        .filter(w => w.length > 0)
                );

                if (blockMap.has(bestTeacher)) {
                    const existing = blockMap.get(bestTeacher);
                    contentWords.forEach(w => existing.add(w));
                } else {
                    blockMap.set(bestTeacher, contentWords);
                }
            }
        });


        // 3. Validate EVERY Teacher in JSON
        const teachers = Object.keys(currentTimetables);
        report.stats.teachersFoundInJson = teachers.length;

        if (teachers.length === 0) {
            report.valid = false;
            report.issues.push("No teachers found in stored data.");
            return report;
        }

        teachers.forEach(teacherName => {
            const result = {
                name: teacherName,
                status: 'OK',
                missingClasses: [],
                pdfMatch: false
            };

            // A. Find the corresponding PDF Block
            // Since blockMap now uses the exact JSON teacher names as keys (from the Ground Truth scan),
            // we can look up directly.




            let matchedBlockKey = null;
            if (blockMap.has(teacherName)) {
                matchedBlockKey = teacherName;
            }


            if (!matchedBlockKey) {
                result.status = 'MISSING_IN_PDF';
                result.pdfMatch = false;
                if (!teacherName.toUpperCase().includes("UNASSIGNED")) {
                    report.warnings.push(`Teacher "${teacherName}" not found in PDF source text.`);
                }
            } else {
                result.pdfMatch = true;
                report.stats.teachersConfirmedInPdf++;

                // B. Scoped Class Check
                const blockWords = blockMap.get(matchedBlockKey);
                const schedule = currentTimetables[teacherName];

                Object.values(schedule).forEach(day => {
                    Object.values(day).forEach(cls => {
                        if (cls && cls !== "Free") {
                            // "Smart Check" within the Teacher's Block
                            if (!checkClassInBlock(cls, blockWords)) {
                                result.missingClasses.push(cls);
                            }
                        }
                    });
                });

                // C. Final Result Logic - moved inside else block where blockWords is defined
                if (result.missingClasses.length > 0) {
                    const uniqueMissing = [...new Set(result.missingClasses)];
                    if (uniqueMissing.length > 0) {
                        report.stats.scopedMismatches++;
                        const debugContent = Array.from(blockWords).join(" ");
                        report.warnings.push(`Mismatch for ${teacherName}: Classes [${uniqueMissing.join(', ')}] listed in App but NOT found. Block starts with: "${debugContent.substring(0, 50)}..."`);
                        result.status = 'MISMATCH';
                    }
                }
            }


            report.details.push(result);
        });

    } catch (error) {
        console.error("Verification Error:", error);
        report.valid = false;
        report.issues.push("Critical Error during PDF processing: " + error.message);
    }

    return report;
}

// --- Helpers ---

/**
 * Checks if a class string (e.g., "10A", "10A/10B", "12 A") exists in the teacher's block words.
 * Returns true if VALID.
 */
function checkClassInBlock(classStr, blockWords) {
    // 0. Ignore Metadata Codes
    if (classStr === 'CC') return true; // Ignore 'CC' (Class Charge/Coordinator)

    const raw = classStr.toUpperCase().trim();

    // 1. Exact Match 
    if (blockWords.has(raw)) return true;
    if (blockWords.has(raw.replace(/\//g, ''))) return true;

    // 2. Tokenize (Split by / , & space)
    // "10A/10B" -> ["10A", "10B"]
    // "6F/6G/7A..." -> ["6F", "6G", "7A", ...]
    const tokens = raw.split(/[\/\s,&]+/).filter(t => t.length > 0);

    if (tokens.length === 0) return true; // Empty string is fine

    // 3. Evaluation Strategy
    let foundCount = 0;

    tokens.forEach(token => {
        let isTokenFound = false;

        // A. Direct check
        // Check exact token or stripped token ("8-A" -> "8A")
        if (blockWords.has(token) || blockWords.has(token.replace(/[^A-Z0-9]/g, ''))) {
            isTokenFound = true;
        }
        else {
            // B. Atomization Check (Handle "12A" vs "12 A")
            // Regex to split Number and Letter: 12A -> 12, A
            const match = token.match(/^(\d+)([A-Z])$/);
            if (match) {
                const num = match[1];
                const lettr = match[2];
                // Check if both '12' and 'A' are present in the block
                if (blockWords.has(num) && blockWords.has(lettr)) {
                    isTokenFound = true;
                }
            }
        }

        if (isTokenFound) foundCount++;
    });

    // Strategy:
    // - If it's a short list (<= 2 items), we need AT LEAST ONE match to be generous.
    // - If it's a long list, we demand > 30% match (lowered from 40% to handle OCR noise).

    if (tokens.length === 1) {
        return foundCount === 1;
    } else {
        return (foundCount / tokens.length) >= 0.3;
    }
}

// Normalize teacher name for comparison
function normalizeName(name) {
    if (!name) return "";
    return name.toUpperCase()
        .replace(/TEACHER/g, '')
        .replace(/MRS\./g, '')
        .replace(/MR\./g, '')
        .replace(/MS\./g, '')
        .replace(/[^A-Z]/g, '') // Remove all non-letters
        .trim();
}

/**
 * Finds the best matching key from a list using loose logic.
 */
function findBestMatch(sourceName, candidates) {
    const normSource = normalizeName(sourceName);
    if (normSource.length < 3) return null;

    // 1. Exact Match
    if (candidates.includes(normSource)) return normSource;

    // 2. Fuzzy Containment
    let bestMatch = null;
    let maxScore = 0;

    for (const candHeader of candidates) {
        const nCand = normalizeName(candHeader);
        if (nCand.length < 3) continue;

        if (nCand.includes(normSource) || normSource.includes(nCand)) {
            const score = Math.min(normSource.length, nCand.length);
            if (score > maxScore) {
                maxScore = score;
                bestMatch = candHeader;
            }
        }
    }

    return bestMatch;
}

/**
 * Extracts distinct "Teacher Blocks" from the PDF.
 * Returns Array of { header: string, content: string }
 */
async function extractTeacherBlocks(pdfArrayBuffer) {
    let allItems = [];
    const loadingTask = pdfjsLib.getDocument({ data: pdfArrayBuffer });
    const pdf = await loadingTask.promise;

    // 1. Get All Items with Coordinates
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        let pageItems = textContent.items.map(item => ({
            str: item.str,
            // Normalizing coordinates logic matched to original parser
            y: Math.floor(viewport.height - item.transform[5]),
            x: Math.floor(item.transform[4]),
            width: item.width, // Needed for merging
            page: i
        })).filter(item => item.str.trim().length > 0);

        // Sort: Top-to-bottom, then Left-to-right (same as pdfParser)
        pageItems.sort((a, b) => Math.abs(a.y - b.y) < 5 ? a.x - b.x : a.y - b.y);

        // Merge horizontal fragments (Critical Factor)
        const merged = [];
        pageItems.forEach(item => {
            const last = merged[merged.length - 1];
            // Merge if on same line (Y diff small) and adjacent (X diff small)
            if (last && Math.abs(last.y - item.y) < 5 && (item.x - (last.x + last.width)) < 15) {
                last.str += " " + item.str;
                last.width = (item.x + item.width) - last.x;
            } else {
                merged.push(item);
            }
        });

        allItems = allItems.concat(merged.map(m => ({
            str: m.str.trim(),
            y: m.y,
            x: m.x,
            page: m.page
        })));
    }

    // 2. Global Sort (Page -> Y -> X) - Re-sort global list just in case
    allItems.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if (Math.abs(a.y - b.y) > 10) return a.y - b.y; // Top to Bottom
        return a.x - b.x; // Left to Right
    });

    // 3. Segment into Blocks
    const blocks = [];
    let currentBlock = null;

    for (const item of allItems) {
        const txt = item.str.trim();
        const upper = txt.toUpperCase();

        // Heuristic: "Teacher" starts a new block
        if (upper.includes("TEACHER") && !upper.includes("CLASS TEACHER") && !upper.includes("SIGN")) {
            // Close previous block
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            // Start new block
            currentBlock = {
                header: txt,
                content: txt // In case name is in the header line itself
            };
        } else {
            if (currentBlock) {
                currentBlock.content += " " + txt;
            }
        }
    }
    // Push last block
    if (currentBlock) blocks.push(currentBlock);

    return blocks;
}
