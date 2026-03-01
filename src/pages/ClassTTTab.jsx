import React, { useState, useMemo, useEffect } from 'react';
import { generateClassTimetableHTML } from '../utils/timetablePrintLayout';
import '../styles/classTTPrint.css';

// two classes per page, grade navigation, print‑friendly black & white layout
export default function ClassTTTab({ generatedTimetable, bellTimings, academicYear }) {
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
        // reset page whenever grade changes
        setPage(1);
    }, [gradeFilter]);

    const classesForGrade = gradeGroups[gradeFilter] || [];
    const pageCount = Math.max(1, Math.ceil(classesForGrade.length / 2));
    const currentClasses = classesForGrade.slice((page - 1) * 2, page * 2);

    const prevPage = () => setPage(p => Math.max(1, p - 1));
    const nextPage = () => setPage(p => Math.min(pageCount, p + 1));

    const renderCard = (className) => {
        if (!className) {
            // nothing to render when there is no class
            return null;
        }
        let html = generateClassTimetableHTML(
            generatedTimetable.classTimetables,
            className,
            academicYear,
            bellTimings
        );
        // simplify header text and adjust footer as per requirement
        html = html.replace(/<div class="school-name">[\s\S]*?<\/div>/,
            '<div class="school-name">THE CHOICE SCHOOL, Tripunithura</div>');
        html = html.replace(/<div class="card-footer">[\s\S]*?<\/div>/,
            '<div class="card-footer"><span style="font-size:8px;float:right;">jkrtripunithura@2025-26</span></div>');

        return (
            <div key={className} className="class-card" dangerouslySetInnerHTML={{ __html: html }} />
        );
    };

    return (
        <div className="class-tt-container">
            <div className="grade-selector">
                {grades.map(g => (
                    <button
                        key={g}
                        className={gradeFilter === g ? 'active' : ''}
                        onClick={() => setGradeFilter(g)}
                    >
                        Grade {g}
                    </button>
                ))}
            </div>
            <div className="nav-row">
                <button onClick={prevPage} disabled={page <= 1}>Previous</button>
                <span>Grade {gradeFilter} - Page {page} of {pageCount}</span>
                <button onClick={nextPage} disabled={page >= pageCount}>Next</button>
            </div>
            <div className="page-group">
                {currentClasses.map(renderCard)}
            </div>
        </div>
    );
}
