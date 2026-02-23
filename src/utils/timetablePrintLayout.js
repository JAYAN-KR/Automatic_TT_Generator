// Timetable Print Layout Generator
// 6 timetables per A4 page, print-optimized

export const generateTeacherTimetableHTML = (teacherTimetables, teacherName, academicYear, bellTimings, isMiddle) => {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Use appropriate bell timings branch
    const mt = isMiddle ? (bellTimings?.middleSchool || {}) : (bellTimings?.seniorSchool || {});

    const tableHeader = `
        <thead>
            <tr>
                <th rowspan="2" class="day-col">Day</th>
                <th>CT</th>
                <th>P1</th>
                <th>P2</th>
                <th class="v-break-head">BRK 1</th>
                <th>P3</th>
                <th>P4</th>
                <th>P5</th>
                <th class="v-break-head">BRK 2</th>
                <th>P6</th>
                <th class="v-break-head">LUNCH</th>
                <th>P7</th>
                <th>P8</th>
            </tr>
            <tr class="time-row">
                <th>${mt.CT || '8:00-8:35'}</th>
                <th>${mt.S1 || '8:35-9:15'}</th>
                <th>${mt.S2 || '9:15-9:55'}</th>
                <th class="v-break-sub">9:55-10:10</th>
                <th>${mt.S4 || '10:10-10:50'}</th>
                <th>${mt.S5 || '10:50-11:30'}</th>
                <th>${mt.S6 || '11:30-12:10'}</th>
                <th class="v-break-sub">12:10-12:20</th>
                <th>${mt.S8 || '12:20-13:00'}</th>
                <th class="v-break-sub">${isMiddle ? (mt.S9 || '13:00-13:30') : (mt.S10 || '13:30-14:05')}</th>
                <th>${isMiddle ? (mt.S10 || '13:30-14:05') : (mt.S9 || '13:00-13:30')}</th>
                <th>${mt.S11 || '14:05-14:55'}</th>
            </tr>
        </thead>
    `;

    // Map subjects for legend
    const subjectsSet = new Set();
    Object.values(teacherTimetables[teacherName] || {}).forEach(day => {
        Object.values(day || {}).forEach(slot => {
            if (slot?.subject) subjectsSet.add(slot.subject);
        });
    });
    const subjectsList = Array.from(subjectsSet).sort();

    const tableBody = dayKeys.map((dayKey, idx) => {
        const schedule = teacherTimetables[teacherName]?.[dayKey] || {};

        const getSubAbbr = (sub) => {
            if (!sub) return '';
            const map = {
                'SANSKRIT': 'Skt',
                'PHYSICS': 'phy',
                'CHEMISTRY': 'Chem',
                'MATHEMATICS': 'Mat',
                'MATH': 'Mat',
                'BIOLOGY': 'Bio',
                'ENGLISH': 'Eng',
                'MALAYALAM': 'Mal',
                'HINDI': 'Hin',
                'HISTORY': 'His',
                'GEOGRAPHY': 'Geo',
                'SOCIAL SCIENCE': 'SS',
                'COMPUTER SCIENCE': 'CS',
                'PHYSICAL EDUCATION': 'PE',
                'ECONOMICS': 'Eco',
                'BUSINESS STUDIES': 'BST',
                'ACCOUNTANCY': 'Acc'
            };
            const upper = sub.trim().toUpperCase();
            return map[upper] || (sub.length > 4 ? sub.substring(0, 3) : sub);
        };

        const getFormattedClass = (className) => {
            if (!className || className === '-' || className === 'EMPTY TEMPLATE') return { num: className, div: '' };
            const parts = className.split(/[\/,]/).map(p => p.trim()).filter(Boolean);
            if (parts.length > 1) {
                let commonNum = '';
                let allDivs = '';
                let consistent = true;
                parts.forEach((p, idx) => {
                    const match = p.match(/^(\d+)([A-Z])$/);
                    if (match) {
                        if (idx === 0) commonNum = match[1];
                        else if (commonNum !== match[1]) consistent = false;
                        allDivs += match[2];
                    } else {
                        consistent = false;
                    }
                });
                if (consistent && commonNum) return { num: commonNum, div: allDivs };
            }
            const singleMatch = className.match(/^(\d+)([A-Z])$/);
            if (singleMatch) return { num: singleMatch[1], div: singleMatch[2] };
            return { num: className, div: '' };
        };

        const renderTeacherCell = (period) => {
            const entry = schedule[period];
            if (!entry) return '&nbsp;';

            const isObj = typeof entry === 'object' && entry !== null;
            const classNameVal = isObj ? entry.className : entry;
            const subjectOrig = isObj ? (entry.subject || '') : '';
            if (!classNameVal || classNameVal === '-') return '&nbsp;';

            const subject = getSubAbbr(subjectOrig);
            const isBlock = isObj && (entry.isBlock || entry.type === 'BLOCK');
            const badge = isBlock ? '<div class="block-badge">BLOCK</div>' : '';
            const groupSuffix = (isObj && entry.isStream && entry.groupName) ? `-${entry.groupName}` : '';

            const { num, div } = getFormattedClass(classNameVal + groupSuffix);
            const isCombined = div && div.length <= 3;

            return `
                ${badge}
                <div style="font-size: 11pt; font-weight: 900; line-height: 1.1;">${num}${isCombined ? `<span style="font-size: 7.5pt; font-weight: 800; margin-left: 1px;">${div}</span>` : ''}</div>
                ${div && !isCombined ? `<div style="font-size: 8pt; font-weight: 800; line-height: 1; max-width: 10mm; word-break: break-all; margin: 0 auto; color: black;">${div}</div>` : ''}
                ${subject ? `<div style="font-size: 7.5pt; font-weight: 800; line-height: 1; color: black;">(${subject})</div>` : ''}
            `;
        };

        // Slots for the row
        const cells = [
            `<td class="day-cell">${days[idx]}</td>`,
            `<td class="period-cell">${renderTeacherCell('CT')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S1')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S2')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S4')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S5')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S6')}</td>`,
            `<td class="period-cell">${renderTeacherCell('S8')}</td>`,
            `<td class="period-cell">${renderTeacherCell(isMiddle ? 'S10' : 'S9')}</td>`, // This is P7
            `<td class="period-cell">${renderTeacherCell('S11')}</td>`, // This is P8
            (() => {
                const lunchSlot = isMiddle ? 'S9' : 'S10';
                const entry = teacherTimetables[teacherName]?.[dayKey]?.[lunchSlot];
                const hasPeriod = entry && (typeof entry === 'object' ? entry.className : entry) && entry !== '-';
                if (hasPeriod) {
                    return `<td class="period-cell" style="background-color: #fff1f2;">${renderTeacherCell(lunchSlot)}</td>`;
                }
                return `<td class="v-break-body" style="background-color: #fef2f2;">LUNCH</td>`;
            })()
        ];

        // Combine with rowspan breaks (BREAK-I and BREAK-II remain rows spanned as they are fixed)
        if (idx === 0) {
            return `
                <tr>
                    ${cells[0]}${cells[1]}${cells[2]}${cells[3]}
                    <td rowspan="6" class="v-break-body">BREAK - I</td>
                    ${cells[4]}${cells[5]}${cells[6]}
                    <td rowspan="6" class="v-break-body">BREAK - II</td>
                    ${cells[7]}
                    ${cells[10]}
                    ${cells[8]}${cells[9]}
                </tr>
            `;
        } else {
            return `
                <tr>
                    ${cells[0]}${cells[1]}${cells[2]}${cells[3]}
                    ${cells[4]}${cells[5]}${cells[6]}
                    ${cells[7]}
                    ${cells[10]}
                    ${cells[8]}${cells[9]}
                </tr>
            `;
        }
    }).join('');

    const colGroup = `
        <colgroup>
            <col style="width: 10%">  <!-- Day -->
            <col style="width: 8%">   <!-- CT -->
            <col style="width: 8%">   <!-- 1 -->
            <col style="width: 8%">   <!-- 2 -->
            <col style="width: 5%">   <!-- BRK 1 -->
            <col style="width: 8%">   <!-- 3 -->
            <col style="width: 8%">   <!-- 4 -->
            <col style="width: 8%">   <!-- 5 -->
            <col style="width: 5%">   <!-- BRK 2 -->
            <col style="width: 8%">   <!-- 6 -->
            <col style="width: 5%">   <!-- LUNCH -->
            <col style="width: 8%">   <!-- 7 -->
            <col style="width: 8%">   <!-- 8 -->
        </colgroup>
    `;

    const legend = subjectsList.length > 0
        ? `<div style="font-size: 7pt; margin-top: 1mm; border-bottom: 0.5px solid #000; padding-bottom: 1px; color: black;">Subjects: ${subjectsList.join(', ')}</div>`
        : '';

    // If teacherName is null or placeholder, don't show "Teacher EMPTY TEMPLATE"
    const displayTeacherName = (teacherName && teacherName !== 'EMPTY TEMPLATE') ? teacherName : '';
    const teacherTitle = displayTeacherName ? `<div class="teacher-title">Teacher ${displayTeacherName}</div>` : '<div class="teacher-title">&nbsp;</div>';

    return `
    <div class="timetable-card">
        <div class="card-header">
            <div class="school-name">THE CHOICE SCHOOL, NADAMA EAST, TRIPUNITHURA, COCHIN</div>
            ${legend}
            ${teacherTitle}
        </div>
        <table class="timetable-table">
            ${colGroup}
            ${tableHeader}
            <tbody>${tableBody}</tbody>
        </table>
        <div class="card-footer">
            <span>Academic Year ${academicYear} | ${isMiddle ? 'Middle' : 'Senior'} School</span>
            <span style="font-style: italic; color: black;">jkrdomain</span>
        </div>
    </div>
    `;
};

export const generateClassTimetableHTML = (classTimetables, className, academicYear, bellTimings) => {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mt = bellTimings?.middleSchool || {};

    const tableHeader = `
        <thead>
            <tr>
                <th rowspan="2" class="day-col">Day</th>
                <th>CT</th>
                <th>P1</th>
                <th>P2</th>
                <th class="v-break-head">BRK 1</th>
                <th>P3</th>
                <th>P4</th>
                <th>P5</th>
                <th class="v-break-head">BRK 2</th>
                <th>P6</th>
                <th class="v-break-head">LUNCH</th>
                <th>P7</th>
                <th>P8</th>
            </tr>
            <tr class="time-row">
                <th>${mt.CT || '8:00-8:35'}</th>
                <th>${mt.P1 || '8:35-9:15'}</th>
                <th>${mt.P2 || '9:15-9:55'}</th>
                <th class="v-break-sub">9:55-10:10</th>
                <th>${mt.P3 || '10:10-10:50'}</th>
                <th>${mt.P4 || '10:50-11:30'}</th>
                <th>${mt.P5 || '11:30-12:10'}</th>
                <th class="v-break-sub">12:10-12:20</th>
                <th>${mt.P6 || '12:20-13:00'}</th>
                <th class="v-break-sub">13:00-13:30</th>
                <th>${mt.P7 || '13:30-14:05'}</th>
                <th>${mt.P8 || '14:05-14:55'}</th>
            </tr>
        </thead>
    `;

    const tableBody = dayKeys.map((dayKey, idx) => {
        const schedule = classTimetables[className]?.[dayKey] || {};
        const renderCell = (period) => {
            const cell = schedule[period];
            if (!cell || !cell.subject) return '&nbsp;';

            if (cell.isStream) {
                const subList = (cell.subjects || []).map(s => s.subject).join(',');
                return `<div style="font-weight: 800; font-size: 8pt; color: black;">${cell.subject}</div><div style="font-size: 5pt; line-height: 1; color: black;">${subList}</div>`;
            }

            const subject = cell.subject;
            const teacher = cell.teacher;
            const badge = (cell.isBlock || cell.type === 'BLOCK') ? '<div class="block-badge">BLOCK</div>' : '';
            return `${badge}${subject}<br><span class="tr-code">${teacher || ''}</span>`;
        };

        const cells = [
            `<td class="day-cell">${days[idx]}</td>`,
            `<td class="period-cell">${renderCell('CT')}</td>`,
            `<td class="period-cell">${renderCell('S1')}</td>`,
            `<td class="period-cell">${renderCell('S2')}</td>`,
            `<td class="period-cell">${renderCell('S4')}</td>`,
            `<td class="period-cell">${renderCell('S5')}</td>`,
            `<td class="period-cell">${renderCell('S6')}</td>`,
            `<td class="period-cell">${renderCell('S8')}</td>`,
            `<td class="period-cell">${renderCell('S9')}</td>`,
            `<td class="period-cell">${renderCell('S11')}</td>`
        ];

        if (idx === 0) {
            return `
                <tr>
                    ${cells[0]}${cells[1]}${cells[2]}${cells[3]}
                    <td rowspan="6" class="v-break-body">BREAK - I</td>
                    ${cells[4]}${cells[5]}${cells[6]}
                    <td rowspan="6" class="v-break-body">BREAK - II</td>
                    ${cells[7]}
                    <td rowspan="6" class="v-break-body">LUNCH</td>
                    ${cells[8]}${cells[9]}
                </tr>
            `;
        } else {
            return `
                <tr>
                    ${cells[0]}${cells[1]}${cells[2]}${cells[3]}
                    ${cells[4]}${cells[5]}${cells[6]}
                    ${cells[7]}
                    ${cells[8]}${cells[9]}
                </tr>
            `;
        }
    }).join('');

    const colGroup = `
        <colgroup>
            <col style="width: 10%">  <!-- Day -->
            <col style="width: 8%">   <!-- CT -->
            <col style="width: 8%">   <!-- 1 -->
            <col style="width: 8%">   <!-- 2 -->
            <col style="width: 5%">   <!-- BRK 1 -->
            <col style="width: 8%">   <!-- 3 -->
            <col style="width: 8%">   <!-- 4 -->
            <col style="width: 8%">   <!-- 5 -->
            <col style="width: 5%">   <!-- BRK 2 -->
            <col style="width: 8%">   <!-- 6 -->
            <col style="width: 5%">   <!-- LUNCH -->
            <col style="width: 8%">   <!-- 7 -->
            <col style="width: 8%">   <!-- 8 -->
        </colgroup>
    `;

    return `
    <div class="timetable-card">
        <div class="card-header">
            <div class="school-name">THE CHOICE SCHOOL, NADAMA EAST, TRIPUNITHURA, COCHIN</div>
            <div class="class-title">Class ${className}</div>
        </div>
        <table class="timetable-table">
            ${colGroup}
            ${tableHeader}
            <tbody>${tableBody}</tbody>
        </table>
        <div class="card-footer">
            <span>Academic Year ${academicYear}</span>
            <span style="font-style: italic; color: black;">jkrdomain</span>
        </div>
    </div>
    `;
};

export const generatePrintCSS = (bellTimings) => `
<style>
    @media print {
        @page {
            size: A4 landscape;
            margin: 5mm;
        }
        body {
            font-family: 'Arial', sans-serif;
            background: white;
            color: black;
            padding: 0;
            margin: 0;
        }
        .page-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            gap: 4mm;
            width: 287mm; /* Based on A4 landscape minus 5mm margins each side */
            height: 200mm;
            page-break-after: always;
            padding: 2mm;
            box-sizing: border-box;
        }
        .timetable-card {
            border: 1.5px solid #000;
            padding: 3mm;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            background: #fff;
            height: 100%;
        }
        .card-header {
            text-align: left;
            margin-bottom: 2mm;
        }
        .school-name {
            font-size: 6.5pt;
            font-weight: bold;
            border-bottom: 0.5px solid #000;
            padding-bottom: 1px;
            text-transform: uppercase;
        }
        .teacher-title, .class-title {
            text-align: center;
            font-size: 13pt;
            font-weight: bold;
            margin: 3mm 0;
        }
        .timetable-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            flex-grow: 1;
            empty-cells: show;
            border: 2px solid #000;
        }
        .timetable-table th, .timetable-table td {
            border: 1px solid #000 !important;
            text-align: center;
            vertical-align: middle;
            padding: 1px;
            font-size: 7.5pt;
            height: 7mm;
            overflow: hidden;
            word-wrap: break-word;
            box-sizing: border-box;
        }
        .time-row th {
            font-size: 5pt;
            font-weight: normal;
            height: 4.5mm !important;
        }
        .v-break-head, .v-break-sub, .v-break-body { 
            border-left: 2pt solid #000 !important;
            border-right: 2pt solid #000 !important;
            background: #fff;
        }

        .v-break-head {
            font-size: 7.5pt;
            font-weight: bold;
            padding: 1px;
        }
        .v-break-sub {
            font-size: 5pt !important;
            font-weight: normal;
        }
        .v-break-body {
            writing-mode: vertical-rl;
            text-orientation: mixed;
            transform: rotate(180deg);
            font-size: 8.5pt;
            font-weight: bold;
            padding: 0;
            text-align: center;
        }

        .day-cell {
            font-weight: bold;
            font-size: 9pt;
            text-transform: uppercase;
            background: #fff;
        }
        .tr-code {
            font-size: 6pt;
            color: #000;
            display: block;
        }
        .block-badge {
            position: absolute;
            top: 0;
            right: 0;
            background: #000;
            color: #fff;
            font-size: 4.5pt;
            padding: 0 1px;
            font-weight: 900;
            line-height: 1;
            z-index: 5;
        }
        .period-cell {
            position: relative;
        }
        .card-footer {
            display: flex;
            justify-content: space-between;
            font-size: 6pt;
            margin-top: 2mm;
            border-top: 1px solid #000;
            padding-top: 1px;
        }
    }
    
    /* Screen Preview Styles */
    .print-preview {
        background: #1e293b;
        padding: 2rem;
        min-height: 100vh;
    }
    .print-preview .page-container {
        background: white;
        margin: 0 auto 2rem auto;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
</style>
`;

export const generateFullPrintHTML = (cards, type = 'teacher', academicYear = '2026-2027', bellTimings) => {
    // Chunk cards into groups of 4 for landscape A4 2x2 grid
    const cardPages = [];
    for (let i = 0; i < cards.length; i += 4) {
        cardPages.push(cards.slice(i, i + 4));
    }

    const pagesHTML = cardPages.map(page => `
        <div class="page-container">
            ${page.join('')}
        </div>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${type === 'teacher' ? 'Teacher' : 'Class'} Timetables - ${academicYear}</title>
    ${generatePrintCSS(bellTimings)}
</head>
<body>
    ${pagesHTML}
    <script>
        window.onload = () => window.print();
    </script>
</body>
</html>`;
};
