import React, { useState, useEffect } from 'react';
import { DAYS, PERIODS, getSubAbbr, getFormattedClass, isDoublePeriodStart, isDoublePeriodEnd } from '../utils/teacherTTGenerator';
import { generateTeacherTimetableHTML, generateFullPrintHTML } from '../utils/timetablePrintLayout';
import '../styles/teacherTT.css';

export default function TeacherTTTab({
    generatedTimetable,
    mappingRows,
    allotmentRows,
    bellTimings,
    saveAllotments,
    academicYear,
    isSaving
}) {
    const [teacherTTSubTab, setTeacherTTSubTab] = useState('Middle');
    const [teacherTTPage, setTeacherTTPage] = useState(1);

    // compute list of teachers broken by level
    const [uniqueMiddle, setUniqueMiddle] = useState([]);
    const [uniqueSenior, setUniqueSenior] = useState([]);

    useEffect(() => {
        const teacherDict = generatedTimetable?.teacherTimetables || {};
        const allTeacherNames = new Set();
        Object.keys(teacherDict).forEach(t => { if (t && t !== 'EMPTY TEMPLATE') allTeacherNames.add(t.trim()); });
        mappingRows.forEach(r => { if (r.teacher && r.teacher !== 'EMPTY TEMPLATE') allTeacherNames.add(r.teacher.trim()); });
        allotmentRows.forEach(r => { if (r.teacher && r.teacher !== 'EMPTY TEMPLATE') allTeacherNames.add(r.teacher.trim()); });

        const middle = [];
        const senior = [];

        Array.from(allTeacherNames).forEach(tName => {
            const trimmedT = tName.trim();
            const mapping = mappingRows.find(m => (m.teacher || '').trim() === trimmedT);
            if (mapping) {
                const level = mapping.level || '';
                if (level === 'Middle') middle.push(trimmedT);
                else senior.push(trimmedT);
            } else {
                const teacherAllotments = allotmentRows.find(r => (r.teacher || '').trim() === trimmedT);
                if (teacherAllotments && teacherAllotments.allotments?.length > 0) {
                    const firstClass = teacherAllotments.allotments[0].classes[0];
                    const grade = parseInt(firstClass) || 0;
                    if (grade >= 1 && grade <= 8) middle.push(trimmedT);
                    else senior.push(trimmedT);
                } else {
                    senior.push(trimmedT);
                }
            }
        });

        setUniqueMiddle([...new Set(middle)].sort((a, b) => a.localeCompare(b)));
        setUniqueSenior([...new Set(senior)].sort((a, b) => a.localeCompare(b)));
    }, [generatedTimetable, mappingRows, allotmentRows]);

    const categoryTeachers = teacherTTSubTab === 'Middle' ? uniqueMiddle : uniqueSenior;
    const emptyTeachers = Array.from(new Set([...(generatedTimetable?.teacherTimetables ? Object.keys(generatedTimetable.teacherTimetables) : []),
        ...mappingRows.map(r => r.teacher),
        ...allotmentRows.map(r => r.teacher)
    ].filter(t => t && t !== 'EMPTY TEMPLATE'))).filter(name => {
        const trimmedName = name.trim();
        const hasAssignments = generatedTimetable?.teacherTimetables?.[trimmedName] &&
            Object.values(generatedTimetable.teacherTimetables[trimmedName]).some(day =>
                Object.values(day).some(p => p && typeof p === 'object' && p.subject)
            );
        const totalAllotmentPeriods = allotmentRows.filter(r => (r.teacher || '').trim() === trimmedName)
            .reduce((sum, r) => sum + (r.total || 0), 0);
        return !hasAssignments && totalAllotmentPeriods === 0;
    });

    const PAGE_SIZE = 4;
    const totalPages = Math.max(1, Math.ceil(categoryTeachers.length / PAGE_SIZE));
    const currentPageTeachers = categoryTeachers.slice((teacherTTPage - 1) * PAGE_SIZE, teacherTTPage * PAGE_SIZE);
    const pageList = [...currentPageTeachers];
    while (pageList.length < PAGE_SIZE) pageList.push(null);

    const handlePrintAll = () => {
        if (!generatedTimetable) return;
        const cards = categoryTeachers.map(t => generateTeacherTimetableHTML(
            generatedTimetable.teacherTimetables,
            t,
            academicYear,
            generatedTimetable.bellTimings,
            teacherTTSubTab === 'Middle'
        ));
        const html = generateFullPrintHTML(cards, 'teacher', academicYear, generatedTimetable.bellTimings);
        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
    };

    const TeacherCard = ({ teacher }) => {
        const trimmedName = (teacher || '').trim();
        const teacherMapping = mappingRows.find(m => (m.teacher || '').trim() === trimmedName);
        const tTT = generatedTimetable?.teacherTimetables?.[trimmedName] || (teacher && generatedTimetable.teacherTimetables?.[teacher]);
        const isMiddle = teacherTTSubTab === 'Middle';

        const subjectsHandled = new Set();
        (teacherMapping?.subjects || []).forEach(s => subjectsHandled.add(s));
        allotmentRows.filter(r => (r.teacher || '').trim() === trimmedName).forEach(r => {
            (r.allotments || []).forEach(al => {
                if (al.subject) subjectsHandled.add(al.subject);
            });
        });
        const subjectsList = Array.from(subjectsHandled).sort();

        return (
            <div style={{
                background: 'white',
                border: '1px solid black',
                padding: '12px',
                borderRadius: '0',
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                overflow: 'hidden'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '8px', borderBottom: '2px solid black', paddingBottom: '4px', minHeight: '30px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'black', fontWeight: 600, marginBottom: '2px' }}>
                        {subjectsList.length > 0 ? `Subjects: ${subjectsList.join(', ')}` : '\u00A0'}
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 900, color: 'black', letterSpacing: '0.05em' }}>
                        {teacher ? teacher.toUpperCase() : 'EMPTY TEMPLATE'}
                    </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', border: '1px solid black' }}>
                    <thead>
                        <tr style={{ background: 'white' }}>
                            <th style={{ border: '1px solid black', width: '35px', fontSize: '0.65rem', padding: '4px', color: 'black' }}>DAY</th>
                            {PERIODS.map(p => {
                                let label = p;
                                if (p === 'S1') label = 'P1';
                                else if (p === 'S2') label = 'P2';
                                else if (p === 'S3') label = 'BRK';
                                else if (p === 'S4') label = 'P3';
                                else if (p === 'S5') label = 'P4';
                                else if (p === 'S6') label = 'P5';
                                else if (p === 'S7') label = 'BRK';
                                else if (p === 'S8') label = 'P6';
                                else if (p === 'S9') label = isMiddle ? 'LUNCH' : 'P7';
                                else if (p === 'S10') label = isMiddle ? 'P7' : 'LUNCH';
                                else if (p === 'S11') label = 'P8';

                                const timings = generatedTimetable?.bellTimings?.[isMiddle ? 'middleSchool' : 'seniorSchool'] || bellTimings?.[isMiddle ? 'middleSchool' : 'seniorSchool'];
                                const timeStr = timings?.[p] || '';

                                return (
                                    <th key={p} style={{ border: '1px solid black', fontSize: '0.6rem', padding: '1px', color: 'black', fontWeight: 900, textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'black', borderBottom: timeStr ? '1px solid black' : 'none', marginBottom: '1px' }}>{label}</div>
                                        {timeStr && (
                                            <div style={{ fontSize: '0.45rem', fontWeight: 900, color: 'black', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                                                {timeStr}
                                            </div>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {DAYS.map((day, di) => (
                            <tr key={day}>
                                <td style={{ border: '1px solid black', fontSize: '0.6rem', fontWeight: 900, textAlign: 'center', background: 'white', padding: '4px', color: 'black' }}>
                                    {day.substring(0, 3).toUpperCase()}
                                </td>
                                {PERIODS.map((p, pi) => {
                                    const isCT = p === 'CT';
                                    const isBreak = p === 'S3' || p === 'S7';
                                    const isLunch = isMiddle ? p === 'S9' : p === 'S10';

                                    if (isCT) {
                                        return (
                                            <td key={p} style={{
                                                border: '1px solid black',
                                                background: '#f1f5f9',
                                                color: 'black',
                                                textAlign: 'center',
                                                fontSize: '0.6rem',
                                                fontWeight: 900
                                            }}>
                                                CT
                                            </td>
                                        );
                                    }

                                    if (isBreak) {
                                        if (di !== 0) return null;
                                        return (
                                            <td key={p} rowSpan={6} style={{
                                                border: '1px solid black',
                                                background: 'white',
                                                color: 'black',
                                                writingMode: 'vertical-lr',
                                                textAlign: 'center',
                                                fontSize: '0.55rem',
                                                fontWeight: 900,
                                                letterSpacing: '0.2em'
                                            }}>
                                                BREAK
                                            </td>
                                        );
                                    }

                                    if (isLunch) {
                                        const lunchSlot = isMiddle ? 'S9' : 'S10';
                                        const isLunchColumnClear = DAYS.every(d => {
                                            const s = tTT?.[d]?.[lunchSlot];
                                            return !s || !(typeof s === 'object' ? s.className : s);
                                        });

                                        if (isLunchColumnClear) {
                                            if (di !== 0) return null;
                                            return (
                                                <td key={p} rowSpan={6} style={{
                                                    border: '1px solid black',
                                                    background: 'white',
                                                    color: 'black',
                                                    writingMode: 'vertical-lr',
                                                    textAlign: 'center',
                                                    fontSize: '0.55rem',
                                                    fontWeight: 900,
                                                    letterSpacing: '0.2em'
                                                }}>
                                                    LUNCH
                                                </td>
                                            );
                                        }

                                        const slot = tTT?.[day]?.[p];
                                        const hasPeriod = slot && (typeof slot === 'object' ? (slot.className || slot.subject) : slot);
                                        if (!hasPeriod) {
                                            return (
                                                <td key={p} style={{
                                                    border: '1px solid black',
                                                    background: '#fef2f2',
                                                    color: 'black',
                                                    textAlign: 'center',
                                                    fontSize: '0.55rem',
                                                    fontWeight: 900
                                                }}>
                                                    LUNCH
                                                </td>
                                            );
                                        }
                                    }

                                    const nextPeriodIdx = pi + 1;
                                    const nextPeriod = nextPeriodIdx < PERIODS.length ? PERIODS[nextPeriodIdx] : null;
                                    const currentSlot = tTT?.[day]?.[p];
                                    const nextSlot = nextPeriod ? tTT?.[day]?.[nextPeriod] : null;

                                    const doubleStart = isDoublePeriodStart(currentSlot, nextSlot, p);
                                    let doubleEnd = false;
                                    if (MERGE_END_PERIODS.includes(p)) {
                                        const prevPeriod = PERIODS[pi - 1];
                                        const prevSlot = tTT?.[day]?.[prevPeriod];
                                        doubleEnd = isDoublePeriodEnd(currentSlot, prevSlot, p);
                                    }

                                    const slot = tTT?.[day]?.[p];
                                    const isObj = slot && typeof slot === 'object';
                                    let displayClass = isObj ? slot.className : (slot || '-');
                                    let displaySub = isObj ? (slot.subject || '') : '';

                                    let labType = '';
                                    if (isObj && slot.labGroup && slot.labGroup !== 'None') {
                                        labType = slot.isLabPeriod ? 'Lab' : 'Th';
                                    }

                                    displaySub = getSubAbbr(displaySub);

                                    const { num, div } = getFormattedClass(displayClass);
                                    const typeIndicator = slot?.isTBlock ? 'T' : (slot?.isLBlock ? 'L' : '');
                                    const indicatorSpan = typeIndicator ? <sub style={{ fontSize: '0.55rem', verticalAlign: 'super', fontWeight: 500, marginLeft: '1px' }}>{typeIndicator}</sub> : null;

                                    const cellClass = ['teacher-tt-cell'];
                                    if (doubleStart) cellClass.push('merged-start');
                                    if (doubleEnd) cellClass.push('merged-end');

                                    if (doubleEnd) {
                                        return (
                                            <td key={p} className={cellClass.join(' ')} style={{
                                                borderLeft: doubleEnd ? 'none' : '1px solid black',
                                                borderRight: doubleStart ? 'none' : '1px solid black'
                                            }}>
                                                {/* blank */}
                                            </td>
                                        );
                                    }

                                    return (
                                        <td key={p} className={cellClass.join(' ')} style={{
                                            borderLeft: doubleEnd ? 'none' : '1px solid black',
                                            borderRight: doubleStart ? 'none' : '1px solid black'
                                        }}>
                                            <div className="cell-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0px', height: '100%', width: doubleStart ? '200%' : '100%' }}>
                                                <div style={{ fontSize: '11.5px', color: 'black', lineHeight: '1.1' }}>
                                                    <span style={{ fontWeight: 600 }}>{num}{div}</span>
                                                </div>
                                                {(labType || indicatorSpan) && (
                                                    <div style={{ fontSize: '9px', fontWeight: 600, color: 'black', lineHeight: '1' }}>
                                                        {labType}{indicatorSpan}
                                                    </div>
                                                )}
                                                {displaySub && (
                                                    <div style={{ fontSize: '10px', fontWeight: 500, color: 'black', lineHeight: '1', marginTop: '1px' }}>
                                                        {displaySub}
                                                    </div>
                                                )}
                                                {isLunch && num === '-' && (
                                                    <div style={{ color: 'black', fontSize: '9px', fontWeight: 600 }}>LUNCH</div>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div style={{ animation: 'fadeIn 0.3s ease-out', maxWidth: '1440px', margin: '0 auto' }}>
            {/* existing UI controls (tabs, save button etc) copied from timetable.jsx */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: '#1e293b', padding: '0.8rem', borderRadius: '1rem', border: '1px solid #334155', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {['Middle', 'Senior'].map(m => (
                        <button
                            key={m}
                            onClick={() => { setTeacherTTSubTab(m); setTeacherTTPage(1); }}
                            style={{
                                padding: '0.7rem 1.4rem',
                                background: teacherTTSubTab === m ? '#4f46e5' : '#334155',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.7rem',
                                cursor: 'pointer',
                                fontWeight: '800',
                                fontSize: '0.9rem',
                                transition: 'all 0.2s',
                                boxShadow: teacherTTSubTab === m ? '0 4px 12px rgba(79, 70, 229, 0.4)' : 'none'
                            }}
                        >
                            {m} School TT ({m === 'Middle' ? uniqueMiddle.length : uniqueSenior.length} teachers)
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => saveAllotments()}
                    disabled={isSaving}
                    style={{
                        padding: '0.5rem 1rem', background: '#10b981', color: 'white', border: 'none',
                        borderRadius: '0.5rem', cursor: isSaving ? 'not-allowed' : 'pointer', fontWeight: 700,
                        fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: isSaving ? 0.7 : 1
                    }}
                >
                    💾 {isSaving ? 'Saving...' : 'Save Data'}
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '1rem 1.5rem', borderRadius: '1rem', marginBottom: '1.5rem', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>PAGE</span>
                        <select
                            value={teacherTTPage}
                            onChange={(e) => setTeacherTTPage(Number(e.target.value))}
                            style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '0.4rem', padding: '0.2rem 0.5rem', fontWeight: '700' }}
                        >
                            {Array.from({ length: totalPages }, (_, i) => (
                                <option key={i} value={i + 1}>{i + 1}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handlePrintAll}
                        style={{ padding: '0.5rem 0.8rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}
                    >
                        <span>🖨️</span> Print All {teacherTTSubTab} Timetables
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '600px' }}>
                {pageList.map((t, idx) => (
                    <div key={idx} style={{ minHeight: '600px' }}>
                        {t ? <TeacherCard teacher={t} /> : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
