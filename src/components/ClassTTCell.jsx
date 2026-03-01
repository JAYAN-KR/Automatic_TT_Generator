import React from 'react';
import { getClubbingIndicator } from '../utils/classTTUtils';

/**
 * Component for rendering a single cell in the Class Timetable.
 * Handles the display of subject, teacher, and clubbing indicators.
 */
const ClassTTCell = ({
    cell,
    currentClass,
    SUBJECT_ABBR = {},
    isChanged = false,
    change = null
}) => {
    if (!cell || !cell.subject) return null;

    if (cell.isStream) {
        return (
            <div className={`tt-cell-parent ${isChanged ? 'tt-cell-changed' : ''}`} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px',
                height: '100%', width: '100%', minHeight: '40px'
            }}>
                <span style={{ fontWeight: 800, fontSize: '0.85em', color: '#fbbf24', lineHeight: 1.1, textAlign: 'center' }}>
                    {cell.subject}
                    <span style={{ fontSize: '0.7em', color: '#f59e0b', fontWeight: 700 }}>
                        {getClubbingIndicator(cell, currentClass)}
                    </span>
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', justifyContent: 'center', maxWidth: '100%' }}>
                    {(cell.subjects || []).map((s, idx) => (
                        <span key={idx} style={{ fontSize: '0.55em', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                            {s.subject}{s.isLabPeriod ? ' [LAB]' : (s.labGroup && s.labGroup !== 'None' ? ' [TH]' : '')}{idx < (cell.subjects.length - 1) ? ',' : ''}
                        </span>
                    ))}
                </div>
                {isChanged && <div className="tt-change-badge" />}
            </div>
        );
    }

    const sub = cell.subject.toUpperCase();
    const abbr = SUBJECT_ABBR[sub] || sub.slice(0, 5);
    const teacherFirst = cell.teacher
        ? (() => {
            const pts = cell.teacher.trim().split(/\s+/);
            const fn = pts[0] ? pts[0][0].toUpperCase() + pts[0].slice(1).toLowerCase() : '';
            const si = pts[1] ? pts[1][0].toUpperCase() : '';
            return si ? `${fn} ${si}` : fn;
        })()
        : '';

    const indicator = getClubbingIndicator(cell, currentClass);

    return (
        <div className={`tt-cell-parent ${isChanged ? 'tt-cell-changed' : ''}`} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            height: '100%', width: '100%', minHeight: '40px'
        }}>
            <span style={{ fontWeight: 700, fontSize: '1em', letterSpacing: '0.02em', lineHeight: 1.1 }}>
                {abbr}{cell.isLabPeriod ? ' [LAB]' : (cell.labGroup && cell.labGroup !== 'None' ? ' [TH]' : '')}{cell.isTBlock ? ' [T]' : (cell.isLBlock ? ' [L]' : '')}
                {indicator && (
                    <span style={{ fontSize: '0.7em', color: '#fbbf24', fontWeight: 900, marginLeft: '2px' }}>
                        {indicator}
                    </span>
                )}
            </span>
            {teacherFirst && <span style={{ fontWeight: 400, fontSize: '0.65em', color: '#000000', lineHeight: 1 }}>{teacherFirst}</span>}

            {isChanged && change && (
                <>
                    <div className="tt-change-badge" />
                    <div className="tt-tooltip">
                        <div style={{ fontWeight: 700, color: '#f97316', marginBottom: '4px' }}>Modification Identified</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ color: '#94a3b8' }}>Was: <span style={{ color: '#f1f5f9' }}>{change.old.subject} ({change.old.teacher || 'None'})</span></span>
                            <span style={{ color: '#94a3b8' }}>Now: <span style={{ color: '#f1f5f9' }}>{change.new.subject} ({change.new.teacher || 'None'})</span></span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ClassTTCell;
