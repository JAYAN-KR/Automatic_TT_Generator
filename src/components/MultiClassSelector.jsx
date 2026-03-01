import React, { useState, useRef, useEffect } from 'react';

// A reusable dropdown for selecting multiple classes (or any strings).
// Props:
//   selectedClasses: array of currently selected values
//   options: array of available values
//   onChange: callback(newSelection)
// The API mirrors the module version previously stored under modules/shared.
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
        <div className="multi-class-selector" ref={dropdownRef}>
            <div className="selected-tags" onClick={() => setIsOpen(!isOpen)}>
                {selectedClasses.map(cls => (
                    <span key={cls} className="class-tag">
                        {cls}
                        <button onClick={(e) => { e.stopPropagation(); toggleClass(cls); }}>×</button>
                    </span>
                ))}
                <span className="dropdown-icon">{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
                <div className="dropdown-options">
                    {options.map(cls => (
                        <label key={cls} className="option">
                            <input
                                type="checkbox"
                                checked={selectedClasses.includes(cls)}
                                onChange={() => toggleClass(cls)}
                            />
                            {cls}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MultiClassSelector;
