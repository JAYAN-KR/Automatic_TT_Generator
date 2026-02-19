// PDF Report Generator for Substitution App
// Uses jsPDF (loaded via CDN in index.html)

export const generateSubstitutionPDF = (data, dateRange, options = {}) => {
    const {
        title = 'SUBSTITUTION REPORT',
        subtitle = 'Teacher Duty Assignment Record',
        statTarget = 'substituteTeacher',
        specificTeacherName = null // New option
    } = options;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = margin;

    // Helper function to add new page if needed
    const checkPageBreak = (requiredSpace = 10) => {
        if (yPos + requiredSpace > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
            return true;
        }
        return false;
    };

    // ===== HEADER =====
    // Background gradient effect (simulated with rectangles)
    doc.setFillColor(59, 130, 246); // Blue
    doc.rect(0, 0, pageWidth, 40, 'F');

    // School Name / Report Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(title, pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitle, pageWidth / 2, 28, { align: 'center' });

    yPos = 50;

    // ===== CUSTOM TEACHER HEADER (Per User Request) =====
    if (specificTeacherName) {
        doc.setTextColor(30, 58, 138); // Dark Blue

        // "Teacher Name"
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`Teacher: ${specificTeacherName}`, margin, yPos);

        // "Date" on the same line, right aligned
        const dateText = `Date: ${dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} to ${dateRange.end}`}`;
        doc.text(dateText, pageWidth - margin, yPos, { align: 'right' });

        yPos += 15; // Space after custom header
    } else {
        // Standard Metadata Section for General Report
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        // Date range box
        doc.setFillColor(240, 249, 255); // Light blue
        doc.setDrawColor(59, 130, 246);
        doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 20, 3, 3, 'FD');

        yPos += 7;
        doc.setFont('helvetica', 'bold');
        doc.text(`Report Period: ${dateRange.start} to ${dateRange.end}`, margin + 5, yPos);
        yPos += 7;
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin + 5, yPos);

        yPos += 20;
    }

    // ===== SUMMARY STATISTICS (Only for General Report) =====
    if (!specificTeacherName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(30, 58, 138); // Dark blue
        doc.text('Summary Statistics', margin, yPos);
        yPos += 8;

        const stats = calculateStats(data, statTarget);

        // Stats boxes
        const boxWidth = (pageWidth - 2 * margin - 10) / 3;
        const boxHeight = 20;

        const statsData = [
            { label: 'Total Substitutions', value: stats.totalSubs, color: [239, 68, 68] }, // Red
            { label: 'Total Days', value: stats.totalDays, color: [34, 197, 94] }, // Green
            { label: 'Teachers Involved', value: stats.totalTeachers, color: [249, 115, 22] } // Orange
        ];

        statsData.forEach((stat, i) => {
            const xPos = margin + i * (boxWidth + 5);
            doc.setFillColor(...stat.color);
            doc.roundedRect(xPos, yPos, boxWidth, boxHeight, 2, 2, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.text(stat.value.toString(), xPos + boxWidth / 2, yPos + 10, { align: 'center' });

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(stat.label, xPos + boxWidth / 2, yPos + 16, { align: 'center' });
        });

        yPos += boxHeight + 15;
    }

    // ===== DETAILED RECORDS =====
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    if (!specificTeacherName) doc.text('Detailed Substitution Records', margin, yPos); // Only show title if strictly needed, or just list tables
    // Actually sticking with showing it for consistency, or maybe skipping it for Teacher view as the Header essentially covers it.
    if (specificTeacherName) {
        // For teacher view, we just jump straight to the table, maximizing space
    } else {
        yPos += 10;
    }

    // Group by section (Senior/Middle)
    const seniorData = data.filter(d => {
        const grade = parseInt(d.class?.match(/^\d+/)?.[0] || '0');
        return grade >= 9 && grade <= 12;
    });

    const middleData = data.filter(d => {
        const grade = parseInt(d.class?.match(/^\d+/)?.[0] || '0');
        return grade >= 6 && grade <= 8;
    });

    // determine font sizes
    const isBigMode = !!specificTeacherName;

    // Render Senior School Section
    if (seniorData.length > 0) {
        checkPageBreak(30);
        renderSection(doc, 'Senior School (Grades 9-12)', seniorData, yPos, margin, pageWidth, checkPageBreak, isBigMode);
        yPos = doc.lastAutoTable.finalY + 10;
    }

    // Render Middle School Section
    if (middleData.length > 0) {
        checkPageBreak(30);
        renderSection(doc, 'Middle School (Grades 6-8)', middleData, yPos, margin, pageWidth, checkPageBreak, isBigMode);
        yPos = doc.lastAutoTable.finalY + 10;
    }

    // ===== FOOTER =====
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Footer line
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, pageHeight - 20, pageWidth - margin, pageHeight - 20);

        // Page number
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'normal');
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 15, { align: 'center' });

        // Signature lines (only on last page)
        if (i === totalPages) {
            const sigY = pageHeight - 35;
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);

            doc.line(margin, sigY, margin + 50, sigY);
            doc.text('Prepared By', margin, sigY + 5);

            doc.line(pageWidth - margin - 50, sigY, pageWidth - margin, sigY);
            doc.text('Principal', pageWidth - margin - 25, sigY + 5, { align: 'center' });
        }
    }

    return doc;
};

// Helper function to render a section table
const renderSection = (doc, title, data, startY, margin, pageWidth, checkPageBreak, isBigMode = false) => {
    // Section header
    doc.setFillColor(248, 250, 252); // Light gray
    doc.setDrawColor(59, 130, 246);
    doc.roundedRect(margin, startY, pageWidth - 2 * margin, 10, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isBigMode ? 12 : 11);
    doc.setTextColor(30, 58, 138);
    doc.text(title, margin + 5, startY + 7);

    // Dynamic styles based on mode
    const headFontSize = isBigMode ? 12 : 9;
    const bodyFontSize = isBigMode ? 11 : 8;
    const cellPadding = isBigMode ? 5 : 3;

    // Use autoTable for the data
    doc.autoTable({
        startY: startY + 12,
        head: [['Date', 'Day', 'Period', 'Class', 'Subject', 'Absent Teacher', 'Substitute']],
        body: data.map(row => [
            row.date,
            row.day,
            row.period.replace('Period', ''),
            row.class,
            row.subject || '-',
            row.absentTeacher,
            row.substituteTeacher
        ]),
        theme: 'grid',
        headStyles: {
            fillColor: [30, 58, 138],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: headFontSize
        },
        bodyStyles: {
            fontSize: bodyFontSize,
            cellPadding: cellPadding
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252]
        },
        columnStyles: {
            0: { cellWidth: isBigMode ? 35 : 25 },
            1: { cellWidth: isBigMode ? 25 : 20 },
            2: { cellWidth: isBigMode ? 20 : 15, halign: 'center' },
            3: { cellWidth: isBigMode ? 30 : 25 },
            4: { cellWidth: isBigMode ? 25 : 20 }, // Subject
            5: { cellWidth: 'auto', textColor: [220, 38, 38] },
            6: { cellWidth: 'auto', textColor: [30, 64, 175] }
        },
        margin: { left: margin, right: margin }
    });
};

// Helper function to calculate statistics
const calculateStats = (data, statTarget = 'substituteTeacher') => {
    const uniqueDates = [...new Set(data.map(d => d.date))];
    const uniqueTeachers = [...new Set(data.map(d => d[statTarget]))];

    return {
        totalSubs: data.length,
        totalDays: uniqueDates.length,
        totalTeachers: uniqueTeachers.filter(t => !t.includes('UNASSIGNED')).length
    };
};

// Function to download the PDF
export const downloadPDF = (doc, filename) => {
    doc.save(filename);
};

// Function to open Gmail with pre-filled data
export const openGmailCompose = (recipients, subject, body) => {
    const to = recipients.to || '';
    const cc = recipients.cc ? recipients.cc.join(',') : '';

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.open(gmailUrl, '_blank');
};


// NEW: Generate PDF for ALL Teacher Timetables
export const generateAllTimetablesPDF = (timetables) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4'); // Portrait for 2x5 grid

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 5; // Reduced from 10 to 5 for tighter spacing

    // Grid layout: 2 columns x 4 rows = 8 timetables per page (Standard - Best Fit)
    const cols = 2;
    const rows = 4;
    const cellWidth = (pageWidth - margin * 3) / cols; // Space for 2 columns + margins
    const cellHeight = (pageHeight - margin * 6) / rows; // Space for 5 rows + margins

    const teacherNames = Object.keys(timetables).sort();
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const periods = ['Period1', 'Period2', 'Period3', 'Period4', 'Period5', 'Period6', 'Period7', 'Period8', 'Period9'];

    // Helper function to format cell content (class + subject)
    // Helper function to format cell content (clean and truncated)
    const formatCellContent = (periodData) => {
        let fullString = '';

        // Extract raw string
        if (typeof periodData === 'string') {
            if (!periodData || periodData === '-' || periodData === 'Free') return '';
            fullString = periodData;
        } else if (typeof periodData === 'object' && periodData !== null) {
            const cls = periodData.class || '';
            const sub = periodData.subject || '';
            // Combine Logic: Treat everything as one bag of tokens
            if (cls === 'Free') return '';
            fullString = `${cls} ${sub}`.trim();
        }

        if (!fullString || fullString === 'Free' || fullString === '') return fullString || '';
        if (fullString === 'CC' || fullString === 'CTT') return fullString;

        // Aggressive Tokenization: Split by anything that isn't a letter/number
        // This handles /, space, newline, pipe, commas, etc.
        const tokens = fullString.split(/[^a-zA-Z0-9]+/).filter(t => t.trim().length > 0);

        let displayClass = '';
        if (tokens.length > 4) {
            // Take first 4 tokens
            displayClass = tokens.slice(0, 4).join('/') + '..'; // 2 dots to save space
        } else {
            // If few tokens, use original string? No, re-join to be safe/clean
            // Or use tokens joined by slash
            displayClass = tokens.join('/');
        }

        // Hard Length Cap
        if (displayClass.length > 22) {
            displayClass = displayClass.slice(0, 20) + '..';
        }

        return displayClass;
    };

    // Helper to check if original data has multiple classes
    const hasMultipleClasses = (periodData) => {
        if (typeof periodData === 'string') {
            return periodData && periodData.includes('/');
        }
        if (typeof periodData === 'object' && periodData !== null) {
            return periodData.class && periodData.class.includes('/');
        }
        return false;
    };

    teacherNames.forEach((teacher, index) => {
        const itemsPerPage = cols * rows;
        const pageIndex = Math.floor(index / itemsPerPage);
        const positionInPage = index % itemsPerPage;

        // Add new page if needed
        if (index > 0 && positionInPage === 0) {
            doc.addPage();
        }

        // Calculate position in grid
        const col = positionInPage % cols;
        const row = Math.floor(positionInPage / cols);

        const xStart = margin + col * (cellWidth + margin);
        const yStart = margin + row * (cellHeight + margin);

        // Draw border around timetable
        doc.setDrawColor(203, 213, 225); // Light gray
        doc.setLineWidth(0.5);
        doc.rect(xStart, yStart, cellWidth, cellHeight);

        // Teacher name header (compact)
        doc.setFillColor(30, 58, 138); // Dark blue
        doc.rect(xStart, yStart, cellWidth, 8, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(teacher.toUpperCase(), xStart + cellWidth / 2, yStart + 5.5, { align: 'center' });

        // Prepare compact table data
        const tableData = days.map(day => {
            const dayData = timetables[teacher][day] || {};
            return [
                day,
                formatCellContent(dayData.Period1 || '-'),
                formatCellContent(dayData.Period2 || '-'),
                formatCellContent(dayData.Period3 || '-'),
                formatCellContent(dayData.Period4 || '-'),
                formatCellContent(dayData.Period5 || '-'),
                formatCellContent(dayData.Period6 || '-'),
                formatCellContent(dayData.Period7 || '-'),
                formatCellContent(dayData.Period8 || '-'),
                formatCellContent(dayData.Period9 || '-')
            ];
        });

        // Store original data for checking multiple classes
        const originalData = days.map(day => {
            const dayData = timetables[teacher][day] || {};
            return [
                dayData.Period1 || '-',
                dayData.Period2 || '-',
                dayData.Period3 || '-',
                dayData.Period4 || '-',
                dayData.Period5 || '-',
                dayData.Period6 || '-',
                dayData.Period7 || '-',
                dayData.Period8 || '-',
                dayData.Period9 || '-'
            ];
        });

        // Render compact table
        doc.autoTable({
            startY: yStart + 8,
            head: [['', '1', '2', '3', '4', '5', '6', '7', '8', '9']],
            body: tableData,
            theme: 'grid',
            tableWidth: cellWidth,
            pageBreak: 'avoid',
            margin: { left: xStart, right: pageWidth - xStart - cellWidth },
            headStyles: {
                fillColor: [71, 85, 105], // Slate 600
                textColor: [255, 255, 255],
                fontSize: 6,
                fontStyle: 'bold',
                halign: 'center',
                cellPadding: 1
            },
            bodyStyles: {
                fontSize: 5, // Slightly smaller to fit both lines
                cellPadding: 0.5,
                halign: 'center',
                valign: 'middle',
                textColor: [30, 41, 59],
                minCellHeight: 6 // Reverted to safe height (8 per page)
            },
            columnStyles: {
                0: {
                    fontStyle: 'bold',
                    fillColor: [241, 245, 249],
                    cellWidth: 12,
                    fontSize: 6
                },
                // Period columns - equal width
                1: { cellWidth: (cellWidth - 12) / 9 },
                2: { cellWidth: (cellWidth - 12) / 9 },
                3: { cellWidth: (cellWidth - 12) / 9 },
                4: { cellWidth: (cellWidth - 12) / 9 },
                5: { cellWidth: (cellWidth - 12) / 9 },
                6: { cellWidth: (cellWidth - 12) / 9 },
                7: { cellWidth: (cellWidth - 12) / 9 },
                8: { cellWidth: (cellWidth - 12) / 9 },
                9: { cellWidth: (cellWidth - 12) / 9 }
            },
            didDrawCell: (data) => {
                // Highlight cells with multiple classes
                if (data.section === 'body' && data.column.index > 0) {
                    const rowIndex = data.row.index - 1; // Adjust for header row
                    const colIndex = data.column.index - 1; // Subtract 1 because first column is day

                    if (originalData[rowIndex]) {
                        const originalValue = originalData[rowIndex][colIndex];
                        if (hasMultipleClasses(originalValue)) {
                            // Add thick border for cells with multiple classes (better for B&W printing)
                            doc.setDrawColor(0, 0, 0); // Black
                            doc.setLineWidth(0.3); // Slightly thicker line
                            doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height);
                            doc.setLineWidth(0.5); // Reset to normal
                        }
                    }
                }
            },
            didDrawPage: (data) => {
                // Ensure table doesn't overflow the cell
                const tableBottom = data.cursor.y;
                if (tableBottom > yStart + cellHeight) {
                    console.warn(`Table for ${teacher} overflowed cell`);
                }
            }
        });
    });

    return doc;
};


/**
 * Generate a simple, clean PDF for a single section (Middle/Senior School)
 * This matches the print preview format - just a table with the substitutions
 */
export const generateSimpleSectionPDF = (substitutions, sectionTitle, day) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = margin;

    // Helper function to add new page if needed
    const checkPageBreak = (requiredSpace = 10) => {
        if (yPos + requiredSpace > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
            return true;
        }
        return false;
    };

    // ===== HEADER =====
    const isSenior = sectionTitle.includes('Senior');
    const headerColor = isSenior ? [37, 99, 235] : [5, 150, 105]; // Blue for Senior, Green for Middle

    doc.setFillColor(...headerColor);
    doc.rect(0, 0, pageWidth, 35, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(sectionTitle.toUpperCase(), pageWidth / 2, 15, { align: 'center' });

    // Date
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const currentDate = new Date().toLocaleDateString('en-GB');
    doc.text(`Date: ${currentDate}`, pageWidth / 2, 25, { align: 'center' });

    yPos = 45;

    // ===== SUBSTITUTION TABLE =====
    if (substitutions.length === 0) {
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'italic');
        doc.text('No substitutions for this section.', pageWidth / 2, yPos, { align: 'center' });
    } else {
        // Prepare table data
        const tableData = substitutions.map(sub => [
            sub.period.replace('Period', ''),
            sub.class,
            sub.subject || '-',
            sub.absentTeacher,
            sub.substituteTeacher || '—',
            '' // Sign column (empty)
        ]);

        // Use autoTable for clean table rendering
        doc.autoTable({
            startY: yPos,
            head: [['PERIOD', 'CLASS', 'SUBJECT', 'ABSENT TEACHER', 'SUBSTITUTE TEACHER', 'SIGN']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: headerColor,
                textColor: [255, 255, 255],
                fontSize: 10,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 9,
                textColor: [30, 41, 59],
                cellPadding: 2
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 20 },
                1: { halign: 'center', cellWidth: 20 },
                2: { halign: 'center', cellWidth: 20 }, // Subject
                3: { halign: 'left', cellWidth: 40 },
                4: { halign: 'left', cellWidth: 40 },
                5: { halign: 'center', cellWidth: 40 }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            margin: { left: margin, right: margin }
        });
    }

    // Add Verification Footer
    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : yPos + 20;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, finalY, margin + 50, finalY);
    doc.text('EXAM COMMITTEE', margin, finalY + 5);

    return doc;
};

/**
 * Generate Exam Duty Tally Sheet
 * Aggregates duties per teacher for a specific exam session
 */
export const generateExamTallyPDF = (substitutions, day) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPos = 20;

    // 1. Filter and Aggregate
    const examDuties = substitutions.filter(s => s.absentTeacher === 'EXAM DUTY');

    // Get Exam Name from first entry (if exists)
    const examName = examDuties.length > 0 ? (examDuties[0].examName || 'EXAM') : 'EXAM';
    const currentDate = new Date().toLocaleDateString('en-GB');

    const tally = {};
    examDuties.forEach(s => {
        const t = s.substituteTeacher;
        if (!t || t.includes('UNASSIGNED')) return;
        tally[t] = (tally[t] || 0) + 1;
    });

    const sortedTeachers = Object.keys(tally).sort();
    const tableData = sortedTeachers.map((name, index) => [
        index + 1,
        name,
        tally[name]
    ]);

    // 2. Header
    doc.setFillColor(30, 58, 138); // Dark Blue
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${examName.toUpperCase()} - DUTY TALLY SHEET`, pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date of Duty: ${day} (Generated: ${currentDate})`, pageWidth / 2, 30, { align: 'center' });

    yPos = 55;

    // 3. Table
    if (tableData.length === 0) {
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.text('No exam duties found in this section.', pageWidth / 2, yPos, { align: 'center' });
    } else {
        doc.autoTable({
            startY: yPos,
            head: [['SL NO.', 'TEACHER NAME', 'TOTAL DUTIES (PERIODS)']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [30, 58, 138],
                textColor: [255, 255, 255],
                fontSize: 11,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 10,
                textColor: [30, 41, 59],
                halign: 'center',
                cellPadding: 2
            },
            columnStyles: {
                0: { cellWidth: 20 },
                1: { cellWidth: 'auto', halign: 'left' },
                2: { cellWidth: 50 }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            margin: { left: margin, right: margin }
        });
    }

    // 4. Verification Footer
    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : yPos + 20;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, finalY, margin + 50, finalY);
    doc.text('EXAM COMMITTEE', margin, finalY + 5);

    return doc;
};

/**
 * NEW (v2.0.0): Generate a Unified, multi-page report for all substitution sections.
 * Handles automatic overflow and repeated headers for long lists.
 */
export const generateUnifiedDutyReportPDF = (sections, day) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const currentDate = new Date().toLocaleDateString('en-GB');

    // Color theme mapping
    const getColors = (type) => {
        if (type === 'Senior') return [30, 58, 138]; // Blue
        if (type === 'Special') return [219, 39, 119]; // Pink/Red
        return [5, 150, 105]; // Green for Main/Middle
    };

    // Helper to draw the professional header block
    const drawHeader = (doc, title, sectionType) => {
        const color = getColors(sectionType);
        doc.setFillColor(...color);
        doc.rect(0, 0, pageWidth, 35, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont('helvetica', 'bold');
        doc.text(title.toUpperCase(), pageWidth / 2, 15, { align: 'center' });

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text(`Day: ${day} | Date: ${currentDate}`, pageWidth / 2, 25, { align: 'center' });
    };

    // Helper to draw Footer on every page
    const drawFooter = (doc, pageNum, totalPages) => {
        doc.setPage(pageNum);
        // Signature lines
        const sigY = pageHeight - 25;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(200, 200, 200);

        doc.line(margin, sigY, margin + 50, sigY);
        doc.text('EXAM COMMITTEE', margin, sigY + 5);

        // Page Number
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    };

    let firstSection = true;

    sections.forEach((section) => {
        if (section.subs.length === 0) return;

        if (!firstSection) {
            doc.addPage();
        }
        firstSection = false;

        // Determine dynamic heading
        let displayHeading = section.title;
        if (section.type === 'Special') {
            const examNameMatch = section.subs.find(s => s.examName)?.examName;
            displayHeading = examNameMatch ? `DUTYLIST FOR ${examNameMatch}` : `DUTYLIST FOR SPECIAL DUTIES`;
        } else {
            displayHeading = `DUTYLIST FOR ${section.title}`;
        }

        // Draw individual section header
        drawHeader(doc, displayHeading, section.type);

        const tableData = section.subs.map(sub => [
            sub.period.replace('Period', ''),
            sub.class,
            sub.subject || '-',
            sub.absentTeacher,
            sub.substituteTeacher || '—',
            '' // Sign
        ]);

        doc.autoTable({
            startY: 45,
            head: [['PERIOD', 'CLASS', 'SUBJECT', 'ABSENT TEACHER', 'SUBSTITUTE TEACHER', 'SIGN']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: getColors(section.type),
                textColor: [255, 255, 255],
                fontSize: 10,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 9,
                textColor: [30, 41, 59],
                cellPadding: 2
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 15 },
                1: { halign: 'center', cellWidth: 20 },
                2: { halign: 'center', cellWidth: 25 },
                3: { halign: 'left', cellWidth: 'auto' },
                4: { halign: 'left', cellWidth: 'auto' },
                5: { halign: 'center', cellWidth: 30 }
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            margin: { left: margin, right: margin, bottom: 35 },
            didDrawPage: (data) => {
                // If the table spans multiple pages, redraw the header on the new page
                if (doc.internal.getNumberOfPages() > data.pageNumber) {
                    drawHeader(doc, displayHeading, section.type);
                }
            }
        });
    });

    // Add footers to all pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        drawFooter(doc, i, totalPages);
    }

    return doc;
};
