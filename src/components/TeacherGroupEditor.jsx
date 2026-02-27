import React, { useState, useRef, useEffect } from 'react';

/**
 * MultiClassSelector Component
 * Handles selection of multiple classes with checkboxes and tag display.
 */
export const MultiClassSelector = ({ selectedClasses, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleClass = (cls) => {
        const newSelection = selectedClasses.includes(cls)
            ? selectedClasses.filter(c => c !== cls)
            : [...selectedClasses, cls];
        onChange(newSelection);
    };

    return (
        <div ref={dropdownRef} style={{ position: 'relative', minWidth: '200px' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.4rem',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    alignItems: 'center',
                    minHeight: '38px'
                }}
            >
                {selectedClasses.length === 0 && (
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Select Classes...</span>
                )}
                {selectedClasses.map(cls => (
                    <span
                        key={cls}
                        style={{
                            background: '#eff6ff',
                            color: '#2563eb',
                            border: '1px solid #bfdbfe',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        {cls}
                        <span
                            onClick={(e) => { e.stopPropagation(); toggleClass(cls); }}
                            style={{ cursor: 'pointer', color: '#ef4444', fontSize: '12px' }}
                        >✕</span>
                    </span>
                ))}
                <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.7rem' }}>▼</span>
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.4rem',
                    marginTop: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 100,
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    {options.map(cls => (
                        <div
                            key={cls}
                            onClick={() => toggleClass(cls)}
                            style={{
                                padding: '8px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                borderBottom: '1px solid #f1f5f9',
                                background: selectedClasses.includes(cls) ? '#f8fafc' : 'white'
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedClasses.includes(cls)}
                                onChange={() => { }} // Controlled by parent div click
                                style={{ pointerEvents: 'none' }}
                            />
                            <span style={{ fontSize: '0.85rem', color: '#1e293b', fontWeight: 600 }}>{cls}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * TeacherGroupEditor Component
 * Modern panel for editing teacher allotment groups.
 */
const TeacherGroupEditor = ({ row, subjects, classOptions, onUpdateGroup, onDeleteGroup, onAddGroup, onClose }) => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {(row.allotments || []).map((group, gIdx) => (
                <div key={group.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#0f172a',
                    padding: '1rem',
                    borderRadius: '0.8rem',
                    border: '1px solid #334155',
                    gap: '1rem'
                }}>
                    {/* Header: Classes, Subject, PPS & Delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#f8fafc', background: '#334155', padding: '2px 8px', borderRadius: '4px' }}>CLASSES (CLUB):</span>
                            <MultiClassSelector
                                selectedClasses={group.classes || []}
                                options={classOptions}
                                onChange={(newSelection) => onUpdateGroup(row.id, gIdx, 'classes', newSelection)}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8' }}>SUBJECT:</span>
                            <select
                                value={group.subject || ''}
                                onChange={e => onUpdateGroup(row.id, gIdx, 'subject', e.target.value)}
                                style={{ background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontWeight: 800, fontSize: '0.85rem', borderRadius: '0.4rem', padding: '6px 10px', minWidth: '150px', outline: 'none' }}
                            >
                                <option value="">-- Select Subject --</option>
                                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#1e293b', padding: '4px 12px', borderRadius: '2rem', border: '1px solid #334155' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#38bdf8' }}>PPS:</span>
                            <select
                                value={group.periods || 0}
                                onChange={e => onUpdateGroup(row.id, gIdx, 'periods', e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: 'white', fontWeight: 900, fontSize: '0.9rem', outline: 'none', cursor: 'pointer' }}
                            >
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n} style={{ color: '#000' }}>{n}</option>)}
                            </select>
                            <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, marginLeft: '4px' }}>periods</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 12px', borderRadius: '2rem', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 900, color: '#10b981', textTransform: 'uppercase' }}>Total Load:</span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'white' }}>{group.periods || 0}</span>
                            <span style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 700 }}>periods</span>
                        </div>
                        <button
                            onClick={() => onDeleteGroup(row.id, gIdx)}
                            style={{ marginLeft: 'auto', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#ef4444', height: '32px', padding: '0 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 900, cursor: 'pointer', transition: 'all 0.2s', gap: '4px' }}
                            title="Remove this group"
                        ><span>✕</span> REMOVE</button>
                    </div>

                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '-0.5rem', marginBottom: '0.2rem', fontStyle: 'italic' }}>
                        {group.classes?.length > 1 ? (
                            <span style={{ color: '#10b981', fontWeight: 800 }}>✓ These classes are CLUBBED (merged) and share the same periods.</span>
                        ) : (
                            <span>💡 To <b>Club Classes</b>, select multiple sections in the "CLASSES (CLUB)" box above.</span>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                        {/* Card: Fixed Block (FB) */}
                        <div style={{ background: 'rgba(79, 70, 229, 0.05)', border: '1px solid #312e81', borderRadius: '0.6rem', padding: '0.8rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.8rem' }}>
                                <input
                                    type="checkbox"
                                    checked={!!group.isFixedBlock}
                                    onChange={e => onUpdateGroup(row.id, gIdx, 'isFixedBlock', e.target.checked)}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#818cf8', textTransform: 'uppercase' }}>Fixed Block (FB)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', opacity: group.isFixedBlock ? 1 : 0.4, pointerEvents: group.isFixedBlock ? 'auto' : 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Day:</span>
                                    <select
                                        value={group.fixedDay || 'Mon'}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'fixedDay', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>From:</span>
                                    <select
                                        value={group.fixedBlockFrom || 'P1'}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'fixedBlockFrom', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>To:</span>
                                    <select
                                        value={group.fixedBlockTo || 'P2'}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'fixedBlockTo', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Card: Theory Block (TB) */}
                        <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid #78350f', borderRadius: '0.6rem', padding: '0.8rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.8rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#f59e0b', textTransform: 'uppercase' }}>Theory Block (TB)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Count:</span>
                                    <select
                                        value={group.tBlock || 0}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'tBlock', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {[0, 1, 2, 4, 6].map(n => <option key={n} value={n}>{n} Periods</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Day:</span>
                                    <select
                                        value={group.tbDay || 'Any'}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'tbDay', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Card: Lab Block (LB) */}
                        <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid #064e3b', borderRadius: '0.6rem', padding: '0.8rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.8rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#10b981', textTransform: 'uppercase' }}>Lab Block (LB)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Count:</span>
                                    <select
                                        value={group.lBlock || 0}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'lBlock', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {[0, 1, 2, 4, 6].map(n => <option key={n} value={n}>{n} Periods</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Day:</span>
                                    <select
                                        value={group.lbDay || 'Any'}
                                        onChange={e => onUpdateGroup(row.id, gIdx, 'lbDay', e.target.value)}
                                        style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                    >
                                        {['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Card: Normal Periods */}
                        <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid #1e3a8a', borderRadius: '0.6rem', padding: '0.8rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.8rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#3b82f6', textTransform: 'uppercase' }}>Normal Periods</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                {(() => {
                                    const fbPeriods = group.isFixedBlock ? (parseInt(group.fixedBlockTo?.replace('P', '')) - parseInt(group.fixedBlockFrom?.replace('P', '')) + 1 || 0) : 0;
                                    const tbPeriods = Number(group.tBlock) || 0;
                                    const lbPeriods = Number(group.lBlock) || 0;
                                    const remaining = Math.max(0, (Number(group.periods) || 0) - fbPeriods - tbPeriods - lbPeriods);

                                    return (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, minWidth: '40px' }}>Force:</span>
                                                <select
                                                    value={group.forceCount || 0}
                                                    onChange={e => onUpdateGroup(row.id, gIdx, 'forceCount', e.target.value)}
                                                    style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px' }}
                                                >
                                                    {Array.from({ length: Math.max(0, remaining) + 1 }, (_, i) => i).map(n => <option key={n} value={n}>{n} to Day</option>)}
                                                </select>
                                                <select
                                                    value={group.forceDay || 'Any'}
                                                    onChange={e => onUpdateGroup(row.id, gIdx, 'forceDay', e.target.value)}
                                                    style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b', fontSize: '0.8rem', fontWeight: 800, padding: '4px 8px', borderRadius: '4px', opacity: (group.forceCount || 0) > 0 ? 1 : 0.5 }}
                                                >
                                                    {['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </div>
                                            <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed #334155' }}>
                                                <span style={{ fontSize: '0.65rem', fontWeight: 800, color: remaining - (group.forceCount || 0) > 0 ? '#10b981' : '#64748b' }}>
                                                    REMAINING: {Math.max(0, remaining - (group.forceCount || 0))} on Any Other Days
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.2rem', borderTop: '1px solid #334155', paddingTop: '1rem' }}>
                <button
                    onClick={() => onAddGroup(row.id)}
                    style={{
                        padding: '0.6rem 1.2rem',
                        background: 'rgba(16, 185, 129, 0.1)',
                        color: '#10b981',
                        border: '1px dashed #10b981',
                        borderRadius: '0.5rem',
                        fontSize: '0.85rem',
                        fontWeight: '800',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                >
                    ＋ Add Group
                </button>

                <button
                    onClick={onClose}
                    style={{
                        padding: '0.6rem 1.2rem',
                        background: '#334155',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontSize: '0.85rem',
                        fontWeight: '800',
                        cursor: 'pointer'
                    }}
                >
                    ✕ Close Editor
                </button>
            </div>
        </div>
    );
};

export default TeacherGroupEditor;
