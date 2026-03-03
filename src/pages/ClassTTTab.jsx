import React, { useState, useEffect, useMemo } from 'react';
import {
    DAYS,
    PERIODS,
    MERGE_END_PERIODS,
    getSubAbbr,
    
} from '../utils/teacherTTGenerator';
import '../styles/classTT.css';

export default function ClassTTTab({ generatedTimetable, bellTimings, academicYear }) {
    // compute sorted list of class names
    const classList = useMemo(() => {
        if (!generatedTimetable || !generatedTimetable.classTimetables) return [];
        return Object.keys(generatedTimetable.classTimetables).sort((a, b) => {
            const ma = a.match(/^(\d+)/);
            const mb = b.match(/^(\d+)/);
            const na = ma ? parseInt(ma[1], 10) : 0;
            const nb = mb ? parseInt(mb[1], 10) : 0;
            if (na !== nb) return na - nb;
            return a.localeCompare(b, undefined, { numeric: true });
        });
    }, [generatedTimetable]);

    const gradeGroups = useMemo(() => {
        const groups = {};
        classList.forEach(cn => {
            const g = cn.match(/^(\d+)/)?.[1] || '0';
            if (!groups[g]) groups[g] = [];
            groups[g].push(cn);
        });
        return groups;
    }, [classList]);

    const grades = ['6', '7', '8', '9', '10', '11', '12'];

    const [gradeFilter, setGradeFilter] = useState('6');
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [gradeFilter]);

    const classesForGrade = gradeGroups[gradeFilter] || [];
    const PAGE_SIZE = 2;
    const pageCount = Math.max(1, Math.ceil(classesForGrade.length / PAGE_SIZE));
    const currentClasses = classesForGrade.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const prevPage = () => setPage(p => Math.max(1, p - 1));
    const nextPage = () => setPage(p => Math.min(pageCount, p + 1));

    const ClassCard = ({ className }) => {
        const schedule = generatedTimetable?.classTimetables?.[className] || {};
        const isMiddle = parseInt(className) <= 8;

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
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>
                        THE CHOICE SCHOOL, Tripunithura
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '900', marginTop: '2px' }}>
                        CLASS {className}
                    </div>
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
                                            const s = schedule?.[d]?.[lunchSlot];
                                            return !s || !(typeof s === 'object' ? s.subject || s.teacher : s);
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

                                        const slot = schedule?.[day]?.[p];
                                        const hasPeriod = slot && (typeof slot === 'object' ? (slot.subject || slot.teacher) : slot);
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

                                    const currentSlot = schedule?.[day]?.[p];
                                    const slot = currentSlot;
                                    const isObj = slot && typeof slot === 'object';
                                    const displaySub = isObj ? getSubAbbr(slot.subject || '') : (slot || '');
                                    const displayTeacher = isObj ? slot.teacher || '' : '';

                                    const cellClass = ['class-tt-cell'];
                                    if (isObj && slot.isBlock) cellClass.push('block-period');

                                    return (
                                        <td key={p} className={cellClass.join(' ')} style={{
                                            borderLeft: '1px solid black',
                                            borderRight: '1px solid black'
                                        }}>
                                            <div className="cell-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0px', height: '100%', width: '100%' }}>
                                                <div style={{ fontSize: '11.5px', color: 'black', lineHeight: '1.1' }}>
                                                    <span style={{ fontWeight: 600 }}>{displaySub}</span>
                                                </div>
                                                {displayTeacher && (
                                                    <div style={{ fontSize: '10px', color: 'black', lineHeight: '1.1', marginTop: '1px' }}>
                                                        {displayTeacher}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ textAlign: 'right', fontSize: '8px', marginTop: '4px' }}>
                    jkrtripunithura@2025-26
                </div>
            </div>
        );
    };

    return (
        <div style={{ animation: 'fadeIn 0.3s ease-out', maxWidth: '1440px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', background: '#1e293b', padding: '0.8rem', borderRadius: '1rem', border: '1px solid #334155', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {grades.map(g => (
                        <button
                            key={g}
                            onClick={() => { setGradeFilter(g); setPage(1); }}
                            style={{
                                padding: '0.7rem 1.4rem',
                                background: gradeFilter === g ? '#4f46e5' : '#334155',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.7rem',
                                cursor: 'pointer',
                                fontWeight: '800',
                                fontSize: '0.9rem',
                                transition: 'all 0.2s',
                                boxShadow: gradeFilter === g ? '0 4px 12px rgba(79, 70, 229, 0.4)' : 'none'
                            }}
                        >
                            Grade {g}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '1rem 1.5rem', borderRadius: '1rem', marginBottom: '1.5rem', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>PAGE</span>
                        <select
                            value={page}
                            onChange={(e) => setPage(Number(e.target.value))}
                            style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '0.4rem', padding: '0.2rem 0.5rem', fontWeight: '700' }}
                        >
                            {Array.from({ length: pageCount }, (_, i) => (
                                <option key={i} value={i + 1}>{i + 1}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', minHeight: '600px' }}>
                {currentClasses.map((c, idx) => (
                    <div key={idx} style={{ minHeight: '600px' }}>
                        {c ? <ClassCard className={c} /> : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
