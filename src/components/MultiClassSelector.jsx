import React, { useState, useRef, useEffect } from 'react';

// A reusable dropdown for selecting multiple classes with professional styling.
// Props:
//   selectedClasses: array of currently selected values
//   options: array of available values
//   onChange: callback(newSelection)
const MultiClassSelector = ({ selectedClasses = [], options = [], onChange }) => {
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
                    maxHeight: '300px',
                    overflowY: 'auto',
                    zIndex: 100,
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '8px',
                    padding: '10px'
                }}>
                    {options.map(cls => (
                        <div
                            key={cls}
                            onClick={() => toggleClass(cls)}
                            style={{
                                padding: '8px 10px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                borderRadius: '0.3rem',
                                background: selectedClasses.includes(cls) ? '#f8fafc' : 'white',
                                border: selectedClasses.includes(cls) ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                                fontSize: '0.8rem'
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedClasses.includes(cls)}
                                onChange={() => { }}
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

export default MultiClassSelector;
