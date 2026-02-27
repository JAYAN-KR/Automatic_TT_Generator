import React from 'react';

/**
 * Component for rendering the footer of the Class Timetable.
 * Displays academic year info and clarifies clubbed class notation.
 */
const ClassTTFooter = ({ academicYear, combinedSubjects = [] }) => {
    // ONLY show footnote if there are combined subjects
    if (!combinedSubjects || combinedSubjects.length === 0) return null;

    let dynamicNote = "";
    if (combinedSubjects.length === 1) {
        const item = combinedSubjects[0];
        // Note: ACC (A/B) indicates Accountancy is taught as a combined class with division B.
        // Or: Note: ACC (w/11B) indicates Accountancy is taught as a combined class with class 11B.
        const withText = item.indicator.includes('/')
            ? `division${item.others.length > 1 ? 's' : ''} ${item.others.map(o => o.replace(/^\d+/, '')).join(' & ')}`
            : `class${item.others.length > 1 ? 'es' : ''} ${item.others.join(', ')}`;

        dynamicNote = (
            <span>
                <b style={{ color: '#fbbf24' }}>{item.abbr}{item.indicator}</b> indicates <b>{item.name}</b> is taught as a combined class with {withText}.
            </span>
        );
    } else {
        // Note: ACC (A/B) and MATH (A/C) indicate subjects taught as combined classes.
        const formattedItems = combinedSubjects.map((item, idx) => (
            <React.Fragment key={idx}>
                <b style={{ color: '#fbbf24' }}>{item.abbr}{item.indicator}</b>
                {idx < combinedSubjects.length - 2 ? ", " : (idx === combinedSubjects.length - 2 ? " and " : "")}
            </React.Fragment>
        ));

        dynamicNote = (
            <span>
                {formattedItems} indicate subjects taught as combined classes.
            </span>
        );
    }

    return (
        <div style={{
            marginTop: '1.5rem',
            padding: '1.2rem',
            background: 'rgba(15, 23, 42, 0.6)',
            borderRadius: '1rem',
            border: '1px solid #334155',
            fontSize: '0.85rem',
            color: '#94a3b8',
            fontStyle: 'italic',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <span style={{ color: '#fbbf24', fontWeight: 800 }}>Note:</span> {dynamicNote}
                </div>
                <div style={{
                    fontSize: '0.75rem',
                    color: '#475569',
                    fontWeight: 700,
                    background: '#0f172a',
                    padding: '0.3rem 0.8rem',
                    borderRadius: '2rem',
                    border: '1px solid #1e293b'
                }}>
                    Academic Year {academicYear || '2026-27'} &nbsp;·&nbsp; jkrdomain
                </div>
            </div>
        </div>
    );
};

export default ClassTTFooter;
