import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractSubjectsFromPDF } from '../utils/pdfExtractor';
import {
    generateTeacherTimetableHTML,
    generateClassTimetableHTML,
    generateFullPrintHTML
} from '../utils/timetablePrintLayout';
import { generateTimetable } from '../utils/timetableGenerator';
import { detectLabConflict, determineLabStatus, LAB_GROUPS, getLabForSubject, LAB_SYSTEM } from '../utils/labSharingValidation';
import { saveTimetableMappings, loadTimetableMappings, publishTimetableVersion, publishTimetableToAPK } from '../services/timetableFirestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import {
    ALL_CLASSES,
    loadDistribution,
    saveDistribution,
    getValue,
    setValue,
    setBulkValues,
    getAllSubjects,
    renameSubject,
    deleteSubject,
    syncSubjectsFromMappings,
    // merged group helpers
    addMergedGroup,
    removeMergedGroup,
    isClassMerged,
    getGroupForClass,
    getMergedGroups
} from '../utils/periodDistributionStore';

// component for feature experimentation
import FormatTTPreview from '../components/FormatTTPreview';

// Firebase imports
import { db } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

// --- Constants ---
const COMMON_SUBJECTS = [
    'ENGLISH', 'MATHEMATICS', 'PHYSICS', 'BIOLOGY', 'CHEMISTRY',
    'ACCOUNTANCY', 'HISTORY', 'GEOGRAPHY', 'ECONOMICS', 'BUSINESS STUDIES',
    'MALAYALAM', 'HINDI', 'SOCIAL SCIENCE', 'COMPUTER SCIENCE',
    'PHYSICAL EDUCATION', 'ART', 'WORK EXPERIENCE', 'SANSKRIT',
    'ARABIC', 'FRENCH', 'ENTREPRENEURSHIP', 'SOCIOLOGY', 'POLITICAL SCIENCE'
];

const TAB_GRADIENTS = [
    'linear-gradient(135deg, #0891b2, #06b6d4)', // Tab 1 (Cyan)
    'linear-gradient(135deg, #7e22ce, #9333ea)', // Tab 2 (Purple)
    'linear-gradient(135deg, #b45309, #d97706)', // Tab 3 (Orange)
    'linear-gradient(135deg, #2563eb, #3b82f6)', // Tab 4 (Blue) - DPT
    'linear-gradient(135deg, #059669, #10b981)', // Tab 5 (Green)
    'linear-gradient(135deg, #b91c1c, #dc2626)', // Tab 6 (Red)
];

const syncLabTimetables = (tt) => {
    if (!tt) return tt;
    const labTimetables = {};
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const PRDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

    Object.values(LAB_SYSTEM).forEach(name => {
        labTimetables[name] = {};
        DAYS.forEach(day => {
            labTimetables[name][day] = {};
            PRDS.forEach(p => {
                labTimetables[name][day][p] = '-';
            });
        });
    });

    Object.keys(tt.classTimetables || {}).forEach(cn => {
        DAYS.forEach(day => {
            PRDS.forEach(p => {
                const slot = tt.classTimetables[cn][day][p];
                if (slot && slot.isLabPeriod) {
                    const lab = getLabForSubject(cn, slot.fullSubject || slot.subject);
                    if (lab && labTimetables[lab]) {
                        labTimetables[lab][day][p] = cn;
                    }
                }
                if (slot && slot.isStream && slot.subjects) {
                    slot.subjects.forEach(s => {
                        if (s.isLabPeriod) {
                            const lab = getLabForSubject(cn, s.subject);
                            if (lab && labTimetables[lab]) {
                                labTimetables[lab][day][p] = cn;
                            }
                        }
                    });
                }
            });
        });
    });
    tt.labTimetables = labTimetables;
    return tt;
};
const rebuildTeacherTimetables = (tt, allotmentRows) => {
    if (!tt || !tt.classTimetables) return tt;
    const teacherTimetables = {};
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const PRDS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

    const allTeachers = [...new Set(allotmentRows.map(r => r.teacher?.trim()).filter(Boolean))];

    allTeachers.forEach(t => {
        teacherTimetables[t] = { weeklyPeriods: 0 };
        DAYS.forEach(day => {
            teacherTimetables[t][day] = { periodCount: 0 };
            PRDS.forEach(p => {
                const isBreak = p === 'S3' || p === 'S7';
                teacherTimetables[t][day][p] = isBreak ? 'BREAK' : '';
            });
        });
    });

    Object.keys(tt.classTimetables).forEach(cn => {
        const classTT = tt.classTimetables[cn];
        DAYS.forEach(day => {
            PRDS.forEach(p => {
                const slot = classTT[day][p];
                if (!slot || !slot.subject || slot.subject === 'BREAK' || slot.subject === 'LUNCH') return;

                if (slot.isStream && slot.subjects) {
                    slot.subjects.forEach(s => {
                        const tName = s.teacher?.trim();
                        if (tName && teacherTimetables[tName]) {
                            teacherTimetables[tName][day][p] = {
                                className: cn,
                                subject: s.subject,
                                fullSubject: s.subject,
                                groupName: s.groupName,
                                isStream: true,
                                streamName: slot.streamName,
                                labGroup: s.labGroup || 'None',
                                targetLabCount: s.targetLabCount,
                                isLabPeriod: s.isLabPeriod
                            };
                            teacherTimetables[tName][day].periodCount++;
                            teacherTimetables[tName].weeklyPeriods++;
                        }
                    });
                } else if (slot.teacher) {
                    const tName = slot.teacher.trim();
                    if (teacherTimetables[tName]) {
                        const existing = teacherTimetables[tName][day][p];
                        if (typeof existing === 'object' && existing && existing.subject === (slot.fullSubject || slot.subject)) {
                            const classes = existing.className.split('/').map(c => c.trim());
                            if (!classes.includes(cn)) {
                                existing.className = [...classes, cn].join('/');
                            }
                        } else {
                            teacherTimetables[tName][day][p] = {
                                className: cn,
                                subject: slot.fullSubject || slot.subject,
                                isBlock: !!slot.isBlock,
                                labGroup: slot.labGroup || 'None',
                                targetLabCount: slot.targetLabCount,
                                isLabPeriod: !!slot.isLabPeriod
                            };
                            teacherTimetables[tName][day].periodCount++;
                            teacherTimetables[tName].weeklyPeriods++;
                        }
                    }
                }
            });
        });
    });

    tt.teacherTimetables = teacherTimetables;
    return tt;
};


const CLASSROOMS = [
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F',
    '12A', '12B', '12C', '12D', '12E', '12F'
];

// --- Timetable Cell Styles for 6A Template ---
function ttCellHeader(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#0f172a',
        color: '#f1f5f9',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        padding: '0.7em 0.3em',
        ...extra
    };
}
function ttCell(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#1e293b',
        color: '#f1f5f9',
        fontWeight: 500,
        fontSize: '1.1em',
        textAlign: 'center',
        verticalAlign: 'middle',
        minWidth: 75,
        height: 68,
        padding: '4px 3px',
        ...extra
    };
}
function ttCellDay(extra = {}) {
    return {
        border: '1px solid #64748b',
        background: '#0f172a',
        color: '#fbbf24',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        minWidth: 60,
        height: 44,
        ...extra
    };
}
function ttCellBreak(label, rowSpan) {
    return {
        border: '1px solid #64748b',
        background: '#1e293b',
        color: '#fbbf24',
        fontWeight: 900,
        fontSize: '1.1em',
        textAlign: 'center',
        minWidth: 40,
        height: 44 * rowSpan,
        verticalAlign: 'middle',
        ...(label.includes('LUNCH') ? { color: '#38bdf8' } : {})
    };
}

// --- Subject Abbreviation Mapping ---
const SUBJECT_ABBR = {
    'ENGLISH': 'ENG',
    'HINDI': 'HIN',
    'FRENCH': 'FRE',
    'MALAYALAM': 'MAL',
    'SANSKRIT': 'SAN',
    'MATHEMATICS': 'MATH',
    'SCIENCE': 'SCI',
    'SOCIAL STUDIES': 'SST',
    'PAINTING': 'PTG',
    'COMPUTER APPLICATION': 'CA',
    'HOME SCIENCE': 'HSC',
    'ARTIFICIAL INTELLIGENCE': 'AI',
    'INTRODUCTION TO FINANCIAL MARKETS': 'IFM',
    'FOOD PRODUCTION': 'FP',
    'DATA SCIENCE': 'DS',
    'PHYSICS': 'PHY',
    'CHEMISTRY': 'CHE',
    'ACCOUNTANCY': 'ACC',
    'BUSINESS STUDIES': 'BUS',
    'SOCIOLOGY': 'SOC',
    'PSYCHOLOGY': 'PSY',
    'COMPUTER SCIENCE': 'CS',
    'BIOLOGY': 'BIO',
    'ECONOMICS': 'ECO',
    'HISTORY': 'HIS',
    'ENTREPRENEURSHIP': 'ENT',
    'INFORMATICS PRACTICES': 'IP',
    'LEGAL STUDIES': 'LEG',
    'APPLIED MATHEMATICS': 'APP M',
    'POLITICAL SCIENCE': 'POL SC',
    'PHYSICAL EDUCATION': 'PE',
    'SWIMMING': 'SWM',
    'MAJOR ARTS': 'MART',
    'MAJOR SPORTS': 'MSPT',
    '2ND LANGUAGE': '2ndLang',
    '3RD LANGUAGE': '3rdLang',
    'ELECTIVE 1': 'Elect1',
    'ELECTIVE 2': 'Elect2',
    'ADDITIONAL LANGUAGE': 'AddL',
    'SKILL': 'skill',
    'SKILL SUBJECTS': 'skill',
    'SKILL SUBJECT': 'skill'
};

const getAbbreviation = (sub) => {
    if (!sub) return '';
    return SUBJECT_ABBR[sub.toUpperCase()] || sub.substring(0, 7).toUpperCase();
};

const getPeriodLabel = (cls, period) => {
    if (!cls || period === 'CT') return period || '';
    const num = cls.match(/\d+/)?.[0];
    const isMiddle = ['6', '7', '8'].includes(num);
    const mapping = {
        'S1': 'P1', 'S2': 'P2', 'S3': 'BRK', 'S4': 'P3', 'S5': 'P4',
        'S6': 'P5', 'S7': 'BRK', 'S8': 'P6',
        'S9': isMiddle ? 'LUNCH' : 'P7',
        'S10': isMiddle ? 'P7' : 'LUNCH',
        'S11': 'P8'
    };
    return mapping[period] || period;
};

const getBuilding = (className) => {
    if (!className) return null;
    const grade = parseInt(className.split('/')[0]) || 0;
    return (grade >= 11) ? 'Senior' : 'Main';
};

// --- Sub-components ---

/**
 * A beautiful simple dropdown for selecting Grade only (Dark Mode)
 */
const GradeDropdown = ({ onSelect, onClose, anchorRect }) => {
    const grades = [6, 7, 8, 9, 10, 11, 12];

    return (
        <div style={{
            position: 'fixed',
            top: anchorRect.bottom + 5,
            left: Math.min(anchorRect.left, window.innerWidth - 150),
            zIndex: 1000,
            background: '#1e293b',
            borderRadius: '0.75rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
            border: '1px solid #334155',
            padding: '0.5rem',
            width: '120px',
            animation: 'fadeInScale 0.15s ease-out'
        }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.2rem' }}>
                {grades.map(g => (
                    <button
                        key={g}
                        onClick={() => onSelect(g.toString())}
                        style={{
                            padding: '0.6rem',
                            border: 'none',
                            borderRadius: '0.4rem',
                            background: 'transparent',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: '#f1f5f9',
                            cursor: 'pointer',
                            transition: 'all 0.1s'
                        }}
                        onMouseOver={(e) => e.target.style.background = '#334155'}
                        onMouseOut={(e) => e.target.style.background = 'transparent'}
                    >
                        Grade {g}
                    </button>
                ))}
                <button
                    onClick={() => onSelect(null)}
                    style={{
                        padding: '0.6rem',
                        border: 'none',
                        borderRadius: '0.4rem',
                        background: 'transparent',
                        textAlign: 'left',
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        color: '#f87171',
                        cursor: 'pointer'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#450a0a'}
                    onMouseOut={(e) => e.target.style.background = 'transparent'}
                >
                    Clear
                </button>
            </div>
            <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.95) translateY(-5px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulseOrange {
          0% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(249, 115, 22, 0); }
          100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
        }
        .tt-cell-changed {
          animation: pulseOrange 2s infinite;
          position: relative;
          border: 1px solid #f97316 !important;
          background: rgba(249, 115, 22, 0.1) !important;
        }
        .tt-change-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 8px;
          height: 8px;
          background: #f97316;
          border-radius: 50%;
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
        }
        .tt-tooltip {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: #0f172a;
          color: white;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          white-space: nowrap;
          z-index: 100;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s;
          border: 1px solid #334155;
          pointer-events: none;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          margin-bottom: 8px;
        }
        .tt-cell-parent:hover .tt-tooltip {
          opacity: 1;
          visibility: visible;
          transform: translateX(-50%) translateY(-4px);
        }
      `}</style>
        </div>
    );
};

const formatClasses = (classes) => {
    if (!classes || classes.length === 0) return '';
    if (classes.length === 1) return classes[0];
    const grade = classes[0].match(/\d+/)?.[0] || '';
    const sections = classes.map(c => c.replace(grade, '')).sort().join('');
    return `${grade}${sections}`;
};

export default function TimetablePage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(() => {
        const saved = localStorage.getItem('tt_active_tab');
        return saved ? parseInt(saved) : 0;
    });

    // Tab 1 (Subjects) State
    const [subjects, setSubjects] = useState(() => {
        const saved = localStorage.getItem('tt_subjects');
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [errorStatus, setErrorStatus] = useState(null);
    // new states for combined tab
    const [uploadedFileName, setUploadedFileName] = useState('');
    const [showAddTeacher, setShowAddTeacher] = useState(false);
    const [showAddSubject, setShowAddSubject] = useState(false);
    const [mappingRows, setMappingRows] = useState(() => {
        const saved = localStorage.getItem('tt_mapping_rows');
        if (!saved) return [];
        try {
            const data = JSON.parse(saved);
            // Migration: Convert flat mappings to teacher-grouped mappings if needed
            if (data.length > 0 && data[0].subject && !data[0].subjects) {
                const grouped = {};
                data.forEach(m => {
                    const tKey = m.teacher || 'Unknown';
                    if (!grouped[tKey]) {
                        grouped[tKey] = {
                            id: m.id || Date.now() + Math.random(),
                            teacher: m.teacher,
                            subjects: [],
                            level: m.level || 'Main'
                        };
                    }
                    if (m.subject && !grouped[tKey].subjects.includes(m.subject)) {
                        grouped[tKey].subjects.push(m.subject);
                    }
                });
                return Object.values(grouped);
            }
            return data;
        } catch { return []; }
    });
    const [addingTeacherRowId, setAddingTeacherRowId] = useState(null);
    const [newTeacherValue, setNewTeacherValue] = useState('');
    const [addingSubjectRowId, setAddingSubjectRowId] = useState(null);
    const [newSubjectValue, setNewSubjectValue] = useState('');

    // Format TT Tab - Grade Sub-tab State
    const [activeGradeSubTab, setActiveGradeSubTab] = useState('6');
    const [activeClassSubTab, setActiveClassSubTab] = useState('6A');

    // Chain Swap State
    const [chainSwapMode, setChainSwapMode] = useState(false);
    const [swapChain, setSwapChain] = useState([]);
    const [swapChainSteps, setSwapChainSteps] = useState([]);
    const [isChainComplete, setIsChainComplete] = useState(false);
    const [chainValidation, setChainValidation] = useState(null);
    const [chainCoords, setChainCoords] = useState([]);
    const formatTTContainerRef = useRef(null);

    const validateChain = () => {
        if (!swapChain.length || !isChainComplete) {
            setChainValidation(null);
            return;
        }

        const conflicts = [];
        const movingOut = new Set(swapChain.map(p => `${p.cls}|${p.day}|${p.period}`));
        const movingIn = new Map(); // key: "cls|day|period", value: content

        const steps = [];
        let curS = 0;
        swapChainSteps.forEach(len => {
            steps.push(swapChain.slice(curS, curS + len));
            curS += len;
        });

        const numUnits = steps.length - 1;
        if (numUnits < 2) return;

        // Map what moves where
        for (let i = 0; i < numUnits; i++) {
            const sourceU = steps[i];
            const destU = steps[(i + 1) % numUnits];
            sourceU.forEach((src, idx) => {
                const dst = destU[idx] || destU[0];
                const content = generatedTimetable.classTimetables[src.cls]?.[src.day]?.[src.period];
                if (content && content.subject) {
                    movingIn.set(`${dst.cls}|${dst.day}|${dst.period}`, content);
                }
            });
        }

        const teacherLoadOnDay = {}; // teacher -> day -> count
        const affectedTeachers = new Set();
        const affectedDays = new Set();

        for (let i = 0; i < numUnits; i++) {
            const sU = steps[i];
            const dU = steps[(i + 1) % numUnits];

            sU.forEach((source, idx) => {
                const dest = dU[idx] || dU[0];
                const cellContent = generatedTimetable.classTimetables[source.cls]?.[source.day]?.[source.period];
                if (!cellContent || !cellContent.subject) return;

                const teacher = cellContent.teacher?.trim();
                const day = dest.day;
                const period = dest.period;
                if (teacher) { affectedTeachers.add(teacher); affectedDays.add(day); }

                // A. Teacher Availability
                if (teacher) {
                    Object.keys(generatedTimetable.classTimetables).forEach(otherCls => {
                        const slot = generatedTimetable.classTimetables[otherCls][day]?.[period];
                        if (slot && slot.teacher?.trim() === teacher) {
                            if (!movingOut.has(`${otherCls}|${day}|${period}`)) {
                                conflicts.push(`${teacher} already teaching ${otherCls} in ${day} ${getPeriodLabel(otherCls, period)} (DPT Check)`);
                            }
                        }
                    });
                }

                // B. Lab Availability
                if (cellContent.isLabPeriod) {
                    const lab = getLabForSubject(source.cls, cellContent.fullSubject || cellContent.subject);
                    if (lab && generatedTimetable.labTimetables[lab]) {
                        const labOccupant = generatedTimetable.labTimetables[lab][day]?.[period];
                        if (labOccupant && labOccupant !== '-' && !movingOut.has(`${labOccupant}|${day}|${period}`)) {
                            conflicts.push(`${lab} occupied by ${labOccupant} in ${day} ${getPeriodLabel(labOccupant, period)} (Lab Check)`);
                        }
                    }
                }

                // C. Tracker for teacher load
                if (teacher) {
                    if (!teacherLoadOnDay[teacher]) teacherLoadOnDay[teacher] = {};
                    if (!teacherLoadOnDay[teacher][day]) {
                        let currentDayLoad = 0;
                        Object.keys(generatedTimetable.classTimetables).forEach(cn => {
                            Object.keys(generatedTimetable.classTimetables[cn][day] || {}).forEach(p => {
                                const s = generatedTimetable.classTimetables[cn][day][p];
                                if (s && s.teacher?.trim() === teacher && !movingOut.has(`${cn}|${day}|${p}`)) {
                                    currentDayLoad++;
                                }
                            });
                        });
                        teacherLoadOnDay[teacher][day] = currentDayLoad;
                    }
                    teacherLoadOnDay[teacher][day]++;
                }
            });
        }

        // D. Building Transition Check (Post-Swap Simulation)
        affectedTeachers.forEach(teacher => {
            affectedDays.forEach(day => {
                const dailySchedule = {};
                const DAYS_PRDS = ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'];

                // Fill current schedule (excluding what's moving out)
                Object.keys(generatedTimetable.classTimetables).forEach(cn => {
                    const classDay = generatedTimetable.classTimetables[cn][day];
                    if (!classDay) return;
                    DAYS_PRDS.forEach(p => {
                        const slot = classDay[p];
                        if (slot && slot.teacher?.trim() === teacher && !movingOut.has(`${cn}|${day}|${p}`)) {
                            dailySchedule[p] = cn;
                        }
                    });
                });

                // Add what's moving in
                movingIn.forEach((content, key) => {
                    const [cn, d, p] = key.split('|');
                    if (d === day && content.teacher?.trim() === teacher) {
                        dailySchedule[p] = cn;
                    }
                });

                // Check Adjacent Pairs for building changes
                const riskyPairs = [['S1', 'S2'], ['S4', 'S5'], ['S5', 'S6']];
                // Senior P6-P7 is S8-S9
                // Middle P7-P8 is S10-S11

                const checkPair = (p1, p2) => {
                    if (dailySchedule[p1] && dailySchedule[p2]) {
                        const b1 = getBuilding(dailySchedule[p1]);
                        const b2 = getBuilding(dailySchedule[p2]);
                        if (b1 !== b2) {
                            conflicts.push(`Building Violation: ${teacher} switching ${b1}->${b2} between ${getPeriodLabel(dailySchedule[p1], p1)} and ${getPeriodLabel(dailySchedule[p2], p2)} on ${day}`);
                        }
                    }
                };

                riskyPairs.forEach(([p1, p2]) => checkPair(p1, p2));

                // Grades specific adjacencies
                if (dailySchedule['S8'] && dailySchedule['S9'] && getBuilding(dailySchedule['S9']) === 'Senior') {
                    // S8 is P6. S9 is P7 for Senior. Adjacent.
                    checkPair('S8', 'S9');
                }
                if (dailySchedule['S9'] && dailySchedule['S10'] && getBuilding(dailySchedule['S9']) === 'Senior' && getBuilding(dailySchedule['S10']) === 'Main') {
                    // S9 is P7 for Senior. S10 is P7 for Middle. Adjacent in timeline.
                    checkPair('S9', 'S10');
                }
                if (dailySchedule['S10'] && dailySchedule['S11'] && getBuilding(dailySchedule['S10']) === 'Main') {
                    // S10 is P7 for Middle. S11 is P8. Adjacent.
                    checkPair('S10', 'S11');
                }
            });
        });

        Object.keys(teacherLoadOnDay).forEach(t => {
            Object.keys(teacherLoadOnDay[t]).forEach(d => {
                if (teacherLoadOnDay[t][d] > 6) {
                    conflicts.push(`${t} would have ${teacherLoadOnDay[t][d]} periods on ${d} (Exceeds max of 6)`);
                }
            });
        });

        setChainValidation({
            conflicts: [...new Set(conflicts)],
            success: conflicts.length === 0
        });
    };

    useEffect(() => {
        if (isChainComplete) validateChain();
        else setChainValidation(null);
    }, [isChainComplete, swapChain]);

    const executeChainSwap = () => {
        if (!swapChain.length || !isChainComplete) return;
        if (!window.confirm("Are you sure you want to execute this chain swap? All affected Class and Teacher schedules will be updated.")) return;

        setGeneratedTimetable(prev => {
            if (!prev) return prev;
            const next = JSON.parse(JSON.stringify(prev));

            const steps = [];
            let current = 0;
            swapChainSteps.forEach(len => {
                steps.push(swapChain.slice(current, current + len));
                current += len;
            });

            const numUnits = steps.length - 1;
            if (numUnits < 2) return prev;

            const originalContents = steps.map(unit =>
                unit.map(p => {
                    const cell = next.classTimetables[p.cls]?.[p.day]?.[p.period];
                    return cell ? JSON.parse(JSON.stringify(cell)) : { subject: '', teacher: '', isTBlock: false, isLBlock: false, isBlock: false };
                })
            );

            for (let i = 0; i < numUnits; i++) {
                const sourceIdx = i;
                const destIdx = (i + 1) % numUnits;

                const sourceContent = originalContents[sourceIdx];
                const destUnit = steps[destIdx];

                destUnit.forEach((p, pIdx) => {
                    const contentToMove = sourceContent[pIdx] || { subject: '', teacher: '' };
                    if (!next.classTimetables[p.cls]) next.classTimetables[p.cls] = {};
                    if (!next.classTimetables[p.cls][p.day]) next.classTimetables[p.cls][p.day] = {};
                    next.classTimetables[p.cls][p.day][p.period] = contentToMove;
                });
            }

            return rebuildTeacherTimetables(syncLabTimetables(next), allotmentRows);
        });

        addToast("✓ Chain swap completed", "success");
        setChainSwapMode(false);
        setSwapChain([]);
        setSwapChainSteps([]);
        setIsChainComplete(false);
    };

    const getBlockEntries = (cls, day, period) => {
        const classTT = generatedTimetable?.classTimetables?.[cls];
        if (!classTT || !classTT[day]) return [{ cls, day, period }];
        const cell = classTT[day][period];
        if (!cell || (!cell.isBlock && !cell.isTBlock && !cell.isLBlock)) return [{ cls, day, period }];

        const periods = ['CT', 'S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'];
        const idx = periods.indexOf(period);
        const entries = [{ cls, day, period }];

        // Check neighbors for same block
        [idx - 1, idx + 1].forEach(nIdx => {
            if (nIdx >= 0 && nIdx < periods.length) {
                const nPeriod = periods[nIdx];
                const nCell = classTT[day][nPeriod];
                if (nCell && (nCell.isBlock || nCell.isTBlock || nCell.isLBlock) &&
                    nCell.subject === cell.subject && nCell.teacher === cell.teacher) {
                    entries.push({ cls, day, period: nPeriod });
                }
            }
        });
        return entries.sort((a, b) => periods.indexOf(a.period) - periods.indexOf(b.period));
    };


    useEffect(() => {
        if (!chainSwapMode || swapChain.length < 1) {
            setChainCoords([]);
            return;
        }

        const updateCoords = () => {
            const coords = [];
            // Group swapChain entries by link index to avoid arrows within blocks
            // For now, let's just use the unique coordinate points (center of blocks)
            // Or simpler: only draw arrows if subject/teacher/cls/day changes between entries
            const uniqueCoords = [];
            swapChain.forEach((item, idx) => {
                const el = document.getElementById(`cell-${item.cls}-${item.day}-${item.period}`);
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const containerRect = formatTTContainerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
                const cx = rect.left + rect.width / 2 - containerRect.left;
                const cy = rect.top + rect.height / 2 - containerRect.top;

                // If this cell is adjacent to the previous one and part of the same block, 
                // we might want to skip drawing an arrow between them.
                if (idx > 0) {
                    const prev = swapChain[idx - 1];
                    const classTT = generatedTimetable?.classTimetables?.[item.cls];
                    const cell = classTT?.[item.day]?.[item.period];
                    const pCell = classTT?.[prev.day]?.[prev.period];
                    if (cell && pCell && cell.subject === pCell.subject && cell.teacher === pCell.teacher && cell.fullSubject === pCell.fullSubject) {
                        // Same block! Just update the last point to be the average or skip
                        return;
                    }
                }
                uniqueCoords.push({ x: cx, y: cy });
            });
            setChainCoords(uniqueCoords);
        };

        const timer = setTimeout(updateCoords, 100);
        window.addEventListener('resize', updateCoords);
        // Using a shorter check or polling might be needed for scroll if it's nested
        const interval = setInterval(updateCoords, 500);

        return () => {
            clearTimeout(timer);
            clearInterval(interval);
            window.removeEventListener('resize', updateCoords);
        };
    }, [swapChain, chainSwapMode, activeGradeSubTab, activeTab]);


    // Teacher TT Tab State
    const [teacherTTSubTab, setTeacherTTSubTab] = useState('Middle');
    const [teacherTTPage, setTeacherTTPage] = useState(1);

    // Tab 2 (Teachers) State
    const [teachers, setTeachers] = useState(() => {
        const saved = localStorage.getItem('tt_teachers');
        return saved ? JSON.parse(saved) : [];
    });

    // -- Classes Alloted (new Tab 1) State --
    const [selectedGroups, setSelectedGroups] = useState([]); // Array of { rowId, groupIndex }
    const [mergePopup, setMergePopup] = useState(null); // { rowId, groupIndices, grade, rect }
    const [expandedGroup, setExpandedGroup] = useState(null); // { rowId, groupIndex }

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (expandedGroup && !e.target.closest('.group-expansion-container')) {
                setExpandedGroup(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [expandedGroup]);

    // --- Interactive Builder State ---
    const [creationStatus, setCreationStatus] = useState(null); // { teacher, subject, messages: [], progress: 0, completedCount: 0, isError: false }
    const [completedCreations, setCompletedCreations] = useState(new Set());
    // deletePopup: null | { row, classGroups: [{className, periods:[{day,periodKey,time}]}], checked: {className: Set<'day|periodKey'>}, expanded: Set<className> }
    const [deletePopup, setDeletePopup] = useState(null);

    const [reassignWizard, setReassignWizard] = useState(null); // { step, row, newTeacher, analysis }
    const [dptViewType, setDptViewType] = useState('Teachers'); // 'Teachers' or 'Classes'

    const [allotmentRows, setAllotmentRows] = useState(() => {
        const saved = localStorage.getItem('tt_allotments');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                const rows = data.rows || [];
                return rows.map(r => {
                    // Migrate single allotment object to array
                    if (r.allotments && !Array.isArray(r.allotments)) {
                        return {
                            ...r,
                            allotments: [{ id: Date.now() + Math.random(), classes: [r.allotments.class || '6A'], periods: r.allotments.periods || 0, isMerged: false }]
                        };
                    }
                    return r;
                });
            } catch { }
        }

        // build rows directly from teacher-subject pairs (one row per pair)
        const pairs = localStorage.getItem('tt_teacher_subject_pairs');
        if (pairs) {
            try {
                const pairsArray = JSON.parse(pairs);
                if (pairsArray.length > 0) {
                    return pairsArray.map(p => ({
                        id: `${p.teacher}||${p.subject}`,
                        teacher: p.teacher,
                        subject: p.subject,
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, blockPeriods: 0, preferredDay: 'Any', isMerged: false, labGroup: 'None' }],
                        total: 0
                    }));
                }
            } catch { }
        }

        // fallback single empty row
        return [{
            id: Date.now(),
            teacher: '',
            subject: '',
            allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false, labGroup: 'None' }],
            total: 0
        }];
    });

    // helper constants for dropdowns
    const CLASS_OPTIONS = [
        '6A', '6B', '6C', '6D', '6E', '6F', '6G',
        '7A', '7B', '7C', '7D', '7E', '7F', '7G',
        '8A', '8B', '8C', '8D', '8E', '8F', '8G',
        '9A', '9B', '9C', '9D', '9E', '9F', '9G',
        '10A', '10B', '10C', '10D', '10E', '10F', '10G',
        '11A', '11B', '11C', '11D', '11E', '11F',
        '12A', '12B', '12C', '12D', '12E', '12F'
    ];
    const PERIOD_OPTIONS = Array.from({ length: 11 }, (_, i) => i);

    const addAllotmentRow = () => {
        setAllotmentRows(prev => [...prev, {
            id: Date.now(),
            teacher: '',
            allotments: [{ id: Date.now() + Math.random(), subject: '', classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false }],
            total: 0
        }]);
    };
    const deleteAllotmentRow = (id) => {
        setAllotmentRows(prev => {
            if (prev.length <= 1) return prev; // keep at least one
            return prev.filter(r => r.id !== id);
        });
    };
    const updateAllotmentField = (id, field, value) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            return { ...r, [field]: value };
        }));
    };
    const updateAllotmentGroup = (rowId, groupIndex, field, value) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const newGroups = [...r.allotments];
            const updatedGroup = { ...newGroups[groupIndex] };

            if (field === 'class') {
                updatedGroup.classes = [value];
            } else if (field === 'subject') {
                updatedGroup.subject = value;
            } else if (field === 'periods') {
                const numVal = Number(value);
                updatedGroup.periods = numVal;
                // When PPS goes to 0, automatically reset blocks and day
                if (numVal === 0) {
                    updatedGroup.tBlock = 0;
                    updatedGroup.lBlock = 0;
                    updatedGroup.preferredDay = 'Any';
                }
            } else if (field === 'tBlock') {
                updatedGroup.tBlock = Number(value);
            } else if (field === 'lBlock') {
                updatedGroup.lBlock = Number(value);
            } else if (field === 'preferredDay') {
                updatedGroup.preferredDay = value;
            } else if (field === 'labGroup') {
                updatedGroup.labGroup = value;
            }

            newGroups[groupIndex] = updatedGroup;
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
    };
    const addAllotmentGroup = (rowId) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            return {
                ...r,
                allotments: [...r.allotments, { id: Date.now() + Math.random(), subject: '', classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false, labGroup: 'None' }]
            };
        }));
    };
    const deleteAllotmentGroup = (rowId, groupIndex) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;

            // If it's the last group, reset it instead of deleting
            if (r.allotments.length <= 1) {
                const lastGroup = r.allotments[r.allotments.length - 1];
                const grade = lastGroup?.classes[0]?.match(/\d+/)?.[0];
                const newGroup = { id: Date.now() + Math.random(), subject: lastGroup?.subject || '', classes: [grade ? grade + 'A' : '6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false };
                return {
                    ...r,
                    allotments: [newGroup],
                    total: 0
                };
            }

            const newGroups = r.allotments.filter((_, idx) => idx !== groupIndex);
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
    };

    const unmergeGroup = (rowId, groupIndex) => {
        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const group = r.allotments[groupIndex];
            if (!group || !group.isMerged) return r;

            // Split merged group into individual class allotments
            const newGroups = [...r.allotments];
            const splitGroups = group.classes.map(c => ({
                id: Date.now() + Math.random(),
                subject: group.subject || '',
                classes: [c],
                periods: group.periods,
                tBlock: 0,
                lBlock: 0,
                preferredDay: group.preferredDay || 'Any',
                isMerged: false
            }));

            newGroups.splice(groupIndex, 1, ...splitGroups);
            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));
        addToast('Group unmerged', 'success');
    };

    const handleMergeConfirm = (periods) => {
        if (!mergePopup) return;
        const numPeriods = Number(periods) || 0;

        setAllotmentRows(prev => prev.map(r => {
            if (r.id !== mergePopup.rowId) return r;

            // Get classes from all selected indices
            const mergedClasses = mergePopup.groupIndices.flatMap(idx => r.allotments[idx].classes);

            // Create the new merged group
            const newGroup = {
                id: Date.now() + Math.random(),
                subject: r.allotments[mergePopup.groupIndices[0]].subject || '',
                classes: [...new Set(mergedClasses)], // Dedupe just in case
                periods: numPeriods,
                tBlock: 0,
                lBlock: 0,
                preferredDay: 'Any',
                isMerged: true
            };

            // Filter out the items that were merged
            const remainingGroups = r.allotments.filter((_, idx) => !mergePopup.groupIndices.includes(idx));

            // Add the new merged group at the position of the first selected index
            const insertIdx = Math.min(...mergePopup.groupIndices);
            const newGroups = [...remainingGroups];
            newGroups.splice(insertIdx, 0, newGroup);

            return {
                ...r,
                allotments: newGroups,
                total: newGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
            };
        }));

        setMergePopup(null);
        setSelectedGroups([]);
        addToast('Classes merged successfully', 'success');
    };

    // ─── DELETE TIMETABLE POPUP HANDLERS ──────────────────────────────────────────
    const PERIOD_TIMES = {
        S1: '8:35', S2: '9:15', S3: '9:55', S4: '10:10',
        S5: '10:50', S6: '11:30', S7: '12:10', S8: '12:20',
        S9: '13:00', S10: '13:30', S11: '14:05'
    };
    const DAY_LABELS = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };

    const handleDeleteClick = (row) => {
        if (!generatedTimetable) {
            addToast('No timetable generated yet.', 'warning');
            return;
        }
        const teacher = row.teacher;
        const tTT = generatedTimetable.teacherTimetables?.[teacher] || {};
        const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const PERIODS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];
        const byClass = {};
        DAYS_ORDER.forEach(day => {
            PERIODS.forEach(p => {
                const slot = tTT[day]?.[p];
                if (!slot) return;
                const classes = (slot.className || '').split('/').map(s => s.trim()).filter(Boolean);
                classes.forEach(cn => {
                    if (!byClass[cn]) byClass[cn] = [];
                    byClass[cn].push({ day, periodKey: p, time: PERIOD_TIMES[p] || '' });
                });
            });
        });
        const classGroups = Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b))
            .map(([className, periods]) => ({ className, periods }));
        if (classGroups.length === 0) {
            addToast('No scheduled periods found for this teacher.', 'info');
            return;
        }
        const checked = {};
        classGroups.forEach(({ className }) => { checked[className] = new Set(); });
        setDeletePopup({ row, classGroups, checked, expanded: new Set() });
    };

    const handleSaveStream = () => {
        if (!streamForm.name || !streamForm.className || !streamForm.periods || streamForm.subjects.some(s => !s.teacher || !s.subject)) {
            addToast('Please fill all stream details correctly (Name, Class, Periods, and all Teacher/Subject pairs)', 'error');
            return;
        }

        const updatedStream = { ...streamForm, id: editingStreamId || Date.now() };
        let updated;
        if (editingStreamId) {
            updated = subjectStreams.map(s => s.id === editingStreamId ? updatedStream : s);
        } else {
            updated = [...subjectStreams, updatedStream];
        }

        setSubjectStreams(updated);
        saveStreams(updated);
        setShowStreamModal(false);
        setEditingStreamId(null);
        setStreamForm({ name: '', abbreviation: '', className: '6A', periods: 4, subjects: [{ teacher: '', subject: '', groupName: '' }] });
        addToast('✅ Stream saved successfully', 'success');
        return updatedStream;
    };

    const handleDeleteStream = (id) => {
        if (!confirm('Are you sure you want to delete this stream?')) return;
        const updated = subjectStreams.filter(s => s.id !== id);
        setSubjectStreams(updated);
        saveStreams(updated);
        addToast('🗑️ Stream deleted', 'success');
    };

    const handleEditStream = (stream) => {
        setEditingStreamId(stream.id);
        setStreamForm(stream);
        setShowStreamModal(true);
    };

    const addSubjectToStream = () => {
        setStreamForm(prev => ({
            ...prev,
            subjects: [...prev.subjects, { teacher: '', subject: '', groupName: '', labGroup: 'None', targetLabCount: 2 }]
        }));
    };

    const removeSubjectFromStream = (idx) => {
        if (streamForm.subjects.length <= 1) return;
        setStreamForm(prev => ({
            ...prev,
            subjects: prev.subjects.filter((_, i) => i !== idx)
        }));
    };

    const updateStreamSubject = (idx, field, value) => {
        setStreamForm(prev => {
            const newSubjects = [...prev.subjects];
            newSubjects[idx] = { ...newSubjects[idx], [field]: value };
            return { ...prev, subjects: newSubjects };
        });
    };

    const handleSmartReassign = (row) => {
        if (!generatedTimetable) {
            addToast('No timetable generated yet.', 'warning');
            return;
        }
        setReassignWizard({
            step: 1,
            row: row,
            newTeacher: null,
            analysis: null,
            options: [],
            selectedGroups: new Set(),
            scope: 'MINIMAL'
        });
    };

    const analyzeReassignmentImpact = (row, newTeacherName) => {
        if (!newTeacherName || !generatedTimetable) return null;
        const oldTeacher = row.teacher;
        const subject = row.subject;
        const affectedClasses = row.allotments.flatMap(a => a.classes);

        const assignments = [];
        affectedClasses.forEach(cls => {
            const classTT = generatedTimetable.classTimetables[cls];
            if (!classTT) return;
            Object.keys(classTT).forEach(day => {
                Object.keys(classTT[day]).forEach(p => {
                    const cell = classTT[day][p];
                    if (cell.teacher === oldTeacher && cell.subject === subject) {
                        assignments.push({ className: cls, day, period: p });
                    }
                });
            });
        });

        const newTeacherTT = generatedTimetable.teacherTimetables[newTeacherName] || {};
        const clashes = assignments.filter(asgn => {
            const slot = newTeacherTT[asgn.day]?.[asgn.period];
            return slot && typeof slot === 'object' && slot.subject;
        }).map(asgn => {
            const slot = newTeacherTT[asgn.day][asgn.period];
            return { ...asgn, conflict: `${slot.subject} in ${slot.className}` };
        });

        // Calculate workload per day
        const DAYS_LIST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dailyWorkload = {};
        DAYS_LIST.forEach(day => {
            const currentCount = Object.values(newTeacherTT[day] || {}).filter(p => p && typeof p === 'object' && p.subject).length;
            const extraCount = assignments.filter(a => a.day === day).length;
            dailyWorkload[day] = {
                current: currentCount,
                extra: extraCount,
                total: currentCount + extraCount
            };
        });

        const overloadedDays = DAYS_LIST.filter(day => dailyWorkload[day].total > 6);
        const currentWorkload = Object.values(dailyWorkload).reduce((sum, d) => sum + d.current, 0);

        // Group assignments for selective transfer UI
        const groups = {};
        assignments.forEach(asgn => {
            const key = asgn.className;
            if (!groups[key]) groups[key] = { className: asgn.className, slots: [] };
            groups[key].slots.push(asgn);
        });

        const groupedAssignments = Object.values(groups).map(g => {
            const dayMap = {};
            g.slots.forEach(s => {
                const label = s.period.replace('S', 'P'); // Simplified label
                if (!dayMap[s.day]) dayMap[s.day] = [];
                dayMap[s.day].push(label);
            });
            const summary = Object.entries(dayMap).map(([day, ps]) => `${day.substring(0, 3)}(${ps.join(',')})`).join(', ');
            return { ...g, summary, count: g.slots.length };
        }).sort((a, b) => a.className.localeCompare(b, undefined, { numeric: true }));

        return { assignments, clashes, currentWorkload, dailyWorkload, overloadedDays, groupedAssignments };
    };

    const executeSmartReassign = async () => {
        if (!reassignWizard) return;
        const { row, newTeacher, strategy, analysis, selectedGroups } = reassignWizard;
        const tt = JSON.parse(JSON.stringify(generatedTimetable));
        const oldTeacher = row.teacher;

        let assignmentsToMove = [];
        if (strategy === 'SELECTIVE') {
            assignmentsToMove = analysis.groupedAssignments
                .filter(g => selectedGroups.has(g.className))
                .flatMap(g => g.slots);
        } else if (strategy === 'DIRECT') {
            assignmentsToMove = analysis.assignments;
        }

        // 1. Update generatedTimetable for DIRECT/SELECTIVE
        if (strategy === 'DIRECT' || strategy === 'SELECTIVE') {
            assignmentsToMove.forEach(asgn => {
                const { className, day, period } = asgn;
                if (tt.teacherTimetables[oldTeacher]?.[day]?.[period]) delete tt.teacherTimetables[oldTeacher][day][period];
                if (tt.classTimetables[className]?.[day]?.[period]) tt.classTimetables[className][day][period].teacher = newTeacher;
                if (!tt.teacherTimetables[newTeacher]) tt.teacherTimetables[newTeacher] = {};
                if (!tt.teacherTimetables[newTeacher][day]) tt.teacherTimetables[newTeacher][day] = {};
                tt.teacherTimetables[newTeacher][day][period] = { subject: row.subject, className: className };
            });
            setGeneratedTimetable(tt);
        }

        // 2. Update allotmentRows surgically
        setAllotmentRows(prev => {
            let nextRows = [...prev];
            const sourceIdx = nextRows.findIndex(r => r.id === row.id);
            if (sourceIdx === -1) return prev;

            const sourceRow = nextRows[sourceIdx];
            const movedAllotments = [];
            const remainingAllotments = [];

            if (strategy === 'DIRECT') {
                movedAllotments.push(...sourceRow.allotments);
                // Keep source row to avoid teacher disappearance
                nextRows[sourceIdx] = { ...sourceRow, allotments: [], total: 0 };
            } else if (strategy === 'SELECTIVE') {
                sourceRow.allotments.forEach(al => {
                    const movedInAl = al.classes.filter(c => selectedGroups.has(c));
                    const keptInAl = al.classes.filter(c => !selectedGroups.has(c));
                    if (movedInAl.length > 0) movedAllotments.push({ ...al, classes: movedInAl });
                    if (keptInAl.length > 0) remainingAllotments.push({ ...al, classes: keptInAl });
                });
                nextRows[sourceIdx] = { ...sourceRow, allotments: remainingAllotments, total: remainingAllotments.reduce((s, a) => s + (a.periods || 0), 0) };
            }

            // Target teacher: Merge moved allotments
            if (movedAllotments.length > 0) {
                const targetId = `${newTeacher}||${row.subject}`;
                const targetIdx = nextRows.findIndex(r => r.id === targetId);
                if (targetIdx > -1) {
                    nextRows[targetIdx] = {
                        ...nextRows[targetIdx],
                        allotments: [...nextRows[targetIdx].allotments, ...movedAllotments],
                        total: nextRows[targetIdx].total + movedAllotments.reduce((s, a) => s + (a.periods || 0), 0)
                    };
                } else {
                    nextRows.push({
                        id: targetId,
                        teacher: newTeacher,
                        subject: row.subject,
                        allotments: movedAllotments,
                        total: movedAllotments.reduce((s, a) => s + (a.periods || 0), 0)
                    });
                }
            }
            return nextRows;
        });

        if (strategy === 'DIRECT') {
            addToast(`Successfully moved all ${row.subject} classes to ${newTeacher}. ${oldTeacher} now has 0 periods for this entry.`, 'success');
            setReassignWizard(null);
        } else if (strategy === 'SELECTIVE') {
            addToast(`Transferred ${assignmentsToMove.length} periods to ${newTeacher}. ${oldTeacher} retains remaining classes.`, 'success');
            setReassignWizard(null);
        } else if (strategy === 'PARTIAL') {
            // Smart Partial: First CLEAR old assignments based on scope
            const affectedGrade = row.allotments[0]?.classes[0]?.match(/\d+/)?.[0];

            if (reassignWizard.scope === 'GRADE' && affectedGrade) {
                // Clear EVERYTHING for this grade level
                Object.keys(tt.classTimetables).forEach(cls => {
                    if (cls.startsWith(affectedGrade)) {
                        Object.keys(tt.classTimetables[cls]).forEach(day => {
                            Object.keys(tt.classTimetables[cls][day]).forEach(p => {
                                const cell = tt.classTimetables[cls][day][p];
                                if (cell.teacher) {
                                    if (tt.teacherTimetables[cell.teacher]?.[day]?.[p]) delete tt.teacherTimetables[cell.teacher][day][p];
                                    tt.classTimetables[cls][day][p] = { subject: '', teacher: '' };
                                }
                            });
                        });
                    }
                });
                setGeneratedTimetable(tt);
                setReassignWizard(null);
                addToast(`Grade ${affectedGrade} cleared. Recommended: Regenerate Grade ${affectedGrade}.`, 'info');
                setActiveTab(6); // Go to generate tab
            } else {
                // Minimal Scope: Clear only the current row's old slots
                analysis.assignments.forEach(asgn => {
                    const { className, day, period } = asgn;
                    if (tt.teacherTimetables[oldTeacher]?.[day]?.[period]) delete tt.teacherTimetables[oldTeacher][day][period];
                    if (tt.classTimetables[className]?.[day]?.[period]) tt.classTimetables[className][day][period] = { subject: '', teacher: '' };
                });
                setGeneratedTimetable(tt);
                setReassignWizard(null);
                addToast('Starting Smart AI Re-placement...', 'info');
                setTimeout(() => {
                    handleCreateSpecific({ ...row, teacher: newTeacher, id: row.id });
                }, 500);
            }
        } else if (strategy === 'FULL') {
            setReassignWizard(null);
            setTimeout(() => setActiveTab(6), 100);
            addToast('Target teacher updated. Recommended: Trigger Full Regeneration.', 'info');
        }
    };

    const removeEmptyTeachers = () => {
        if (!confirm('Are you sure you want to remove all teachers with 0 periods? This will clean up the list.')) return;

        const teachersToRemove = new Set();
        const teacherTTDict = generatedTimetable?.teacherTimetables || {};

        // Find teachers who have 0 assignments AND 0 totals in allotments
        const allTeacherNames = new Set([
            ...Object.keys(teacherTTDict),
            ...mappingRows.map(r => r.teacher),
            ...allotmentRows.map(r => r.teacher)
        ].filter(t => t && t !== 'EMPTY TEMPLATE'));

        allTeacherNames.forEach(name => {
            const hasAssignments = teacherTTDict[name] && Object.values(teacherTTDict[name]).some(day => Object.values(day).some(p => p && typeof p === 'object' && p.subject));
            const totalAllotmentPeriods = allotmentRows.filter(r => r.teacher === name).reduce((sum, r) => sum + (r.total || 0), 0);
            if (!hasAssignments && totalAllotmentPeriods === 0) {
                teachersToRemove.add(name);
            }
        });

        if (teachersToRemove.size === 0) {
            addToast('No empty teachers found.', 'info');
            return;
        }

        setAllotmentRows(prev => prev.filter(r => !teachersToRemove.has(r.teacher)));
        setMappingRows(prev => prev.filter(r => !teachersToRemove.has(r.teacher)));

        addToast(`Removed ${teachersToRemove.size} teachers with 0 periods.`, 'success');
    };

    const executeDelete = () => {
        if (!deletePopup) return;
        const { row, classGroups, checked } = deletePopup;
        const teacher = row.teacher;
        const toDelete = [];
        classGroups.forEach(({ className, periods }) => {
            const sel = checked[className];
            periods.forEach(({ day, periodKey }) => {
                if (sel.has(`${day}|${periodKey}`)) toDelete.push({ day, periodKey, className });
            });
        });
        if (toDelete.length === 0) { addToast('No periods selected to delete.', 'warning'); return; }
        setGeneratedTimetable(prev => {
            if (!prev) return prev;
            const next = {
                ...prev,
                classTimetables: JSON.parse(JSON.stringify(prev.classTimetables || {})),
                teacherTimetables: JSON.parse(JSON.stringify(prev.teacherTimetables || {}))
            };
            toDelete.forEach(({ day, periodKey, className }) => {
                if (next.classTimetables[className]?.[day]?.[periodKey]) {
                    delete next.classTimetables[className][day][periodKey];
                }
                const tSlot = next.teacherTimetables[teacher]?.[day]?.[periodKey];
                if (tSlot) {
                    const rem = (tSlot.className || '').split('/').map(s => s.trim()).filter(cn => cn !== className);
                    if (rem.length === 0) delete next.teacherTimetables[teacher][day][periodKey];
                    else next.teacherTimetables[teacher][day][periodKey] = { ...tSlot, className: rem.join('/') };
                }
            });
            return next;
        });
        const byClassMsg = {};
        toDelete.forEach(({ day, periodKey, className }) => {
            if (!byClassMsg[className]) byClassMsg[className] = [];
            byClassMsg[className].push(`${DAY_LABELS[day] || day} ${periodKey}`);
        });
        Object.entries(byClassMsg).forEach(([cn, slots]) => {
            addToast(`🗑️ Deleted ${slots.length} period(s) from ${cn}: ${slots.join(', ')}`, 'success');
        });
        setCompletedCreations(prev => {
            const next = new Set(prev);
            classGroups.forEach(({ className, periods }) => {
                const sel = checked[className];
                if (sel.size > 0) next.delete(row.id);
            });
            return next;
        });
        setDeletePopup(null);
    };

    // Persistent Storage Management for Allotments
    const saveAllotments = async (rows) => {
        const dataToSave = rows || allotmentRows;
        console.log('📦 Starting save process...', { rowCount: dataToSave.length });

        // 1. Save to localStorage (Instant fallback)
        try {
            localStorage.setItem('tt_allotments', JSON.stringify({ rows: dataToSave }));
            console.log('✅ LocalStorage backup updated');
        } catch (e) { console.error('❌ Local save failed', e); }

        // 2. Save to Firestore (Permanent Cloud Storage)
        try {
            setIsSaving(true);
            console.log('📡 Attempting Cloud Save to Firestore...');

            const docRef = doc(db, 'allotments', academicYear);

            // Add a 10-second timeout so the button doesn't stay stuck
            const savePromise = setDoc(docRef, {
                rows: dataToSave,
                lastUpdated: new Date().toISOString(),
                academicYear
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Cloud request timed out. Check your internet or Firebase Rules.')), 10000)
            );

            await Promise.race([savePromise, timeoutPromise]);

            console.log('🚀 Cloud Save Successful!');
            addToast('✅ Data saved to Cloud & Browser', 'success');
        } catch (e) {
            console.error('❌ Cloud save failed error:', e);
            addToast(`⚠️ Browser save only: ${e.message}`, 'warning');
        } finally {
            setIsSaving(false);
        }
    };

    const loadAllotments = async () => {
        setIsLoading(true);
        try {
            // 1. Try Firestore first (Primary source)
            const docRef = doc(db, 'allotments', academicYear);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.rows && data.rows.length > 0) {
                    setAllotmentRows(data.rows);
                    localStorage.setItem('tt_allotments', JSON.stringify({ rows: data.rows }));
                    addToast('☁️ Loaded from Cloud', 'success');
                    setIsLoading(false);
                    return true;
                }
            }

            // 2. Fallback to localStorage if Firestore is empty/fails
            const localSaved = localStorage.getItem('tt_allotments');
            if (localSaved) {
                const data = JSON.parse(localSaved);
                if (data.rows && data.rows.length > 0) {
                    setAllotmentRows(data.rows);
                    addToast('📋 Loaded from Browser backup', 'success');
                    setIsLoading(false);
                    return true;
                }
            }
        } catch (e) {
            console.error('Data load error:', e);
            addToast('❌ Failed to load cloud data', 'error');
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    const clearAllotments = async () => {
        if (confirm('⚠️ Are you sure? This will delete all saved allotments from CLOUD and browser.')) {
            try {
                // Clear Cloud
                const docRef = doc(db, 'allotments', academicYear);
                await deleteDoc(docRef);

                // Clear Local
                localStorage.removeItem('tt_allotments');

                // Reset to default from teacher-subject pairs if possible
                const pairs = localStorage.getItem('tt_teacher_subject_pairs');
                if (pairs) {
                    const pairsArray = JSON.parse(pairs);
                    const resetRows = pairsArray.map(p => ({
                        id: `${p.teacher}||${p.subject}`,
                        teacher: p.teacher,
                        subject: p.subject,
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false }],
                        total: 0
                    }));
                    setAllotmentRows(resetRows);
                } else {
                    setAllotmentRows([{
                        id: Date.now(),
                        teacher: '',
                        subject: '',
                        allotments: [{ id: Date.now() + Math.random(), classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false }],
                        total: 0
                    }]);
                }
                addToast('🧹 All data cleared', 'success');
            } catch (e) {
                console.error('Clear failed:', e);
                addToast('❌ Clear failed', 'error');
            }
        }
    };

    const saveStreams = async (streams) => {
        const dataToSave = streams || subjectStreams;
        try {
            localStorage.setItem('tt_streams', JSON.stringify(dataToSave));
            const docRef = doc(db, 'streams', academicYear);
            await setDoc(docRef, {
                streams: dataToSave,
                lastUpdated: new Date().toISOString(),
                academicYear
            });
            console.log('🚀 Streams saved to Cloud');
        } catch (e) {
            console.error('❌ Streams save failed', e);
        }
    };

    const loadStreams = async () => {
        try {
            const docRef = doc(db, 'streams', academicYear);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.streams) {
                    setSubjectStreams(data.streams);
                    localStorage.setItem('tt_streams', JSON.stringify(data.streams));
                    return true;
                }
            }
            const local = localStorage.getItem('tt_streams');
            if (local) setSubjectStreams(JSON.parse(local));
        } catch (e) {
            console.error('❌ Streams load failed', e);
        }
        return false;
    };

    // ── Cloud Save / Load for Teachers & Subjects tab ────────────────────────
    const saveDptData = async (rowsOverride, teachersOverride, subjectsOverride) => {
        const rowsToSave = rowsOverride || mappingRows;
        const teachersSave = teachersOverride || teachers;
        const subjectsSave = subjectsOverride || subjects;

        // 1. Always write to localStorage first (immediate fallback)
        try {
            localStorage.setItem('tt_mapping_rows', JSON.stringify(rowsToSave));
            localStorage.setItem('tt_teachers', JSON.stringify(teachersSave));
            localStorage.setItem('tt_subjects', JSON.stringify(subjectsSave));
        } catch (e) { console.error('LocalStorage DPT save failed', e); }

        // 2. Write to Firestore
        try {
            setIsSaving(true);
            const docRef = doc(db, 'dpt_data', academicYear);
            await setDoc(docRef, {
                mappingRows: rowsToSave,
                teachers: teachersSave,
                subjects: subjectsSave,
                lastUpdated: new Date().toISOString(),
                academicYear
            });
            addToast('✅ Teachers & Subjects saved to Cloud & Browser', 'success');
            console.log('☁️ [DPT] Cloud save successful —', rowsToSave.length, 'rows,', teachersSave.length, 'teachers');
        } catch (e) {
            console.error('Cloud DPT save failed', e);
            addToast('⚠️ Browser saved only (cloud error): ' + e.message, 'warning');
        } finally {
            setIsSaving(false);
        }
    };

    const loadDptData = async () => {
        try {
            // 1. Try Firestore first
            const docRef = doc(db, 'dpt_data', academicYear);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                let loaded = false;
                if (data.mappingRows && data.mappingRows.length > 0) {
                    setMappingRows(data.mappingRows);
                    localStorage.setItem('tt_mapping_rows', JSON.stringify(data.mappingRows));
                    loaded = true;
                }
                if (data.teachers && data.teachers.length > 0) {
                    setTeachers(data.teachers);
                    localStorage.setItem('tt_teachers', JSON.stringify(data.teachers));
                    loaded = true;
                }
                if (data.subjects && data.subjects.length > 0) {
                    setSubjects(data.subjects);
                    localStorage.setItem('tt_subjects', JSON.stringify(data.subjects));
                    loaded = true;
                }
                if (loaded) {
                    addToast('☁️ Teachers & Subjects loaded from Cloud', 'success');
                    console.log('☁️ [DPT] Cloud load OK —', data.mappingRows?.length, 'rows,', data.teachers?.length, 'teachers');
                    return;
                }
            }
            // 2. Fall back to localStorage
            const localRows = localStorage.getItem('tt_mapping_rows');
            if (localRows) {
                const parsed = JSON.parse(localRows);
                if (parsed.length > 0) {
                    setMappingRows(parsed);
                    console.log('[DPT] Loaded from localStorage backup:', parsed.length, 'rows');
                }
            }
        } catch (e) {
            console.error('[DPT] Cloud load failed, using localStorage:', e.message);
            try {
                const localRows = localStorage.getItem('tt_mapping_rows');
                if (localRows) setMappingRows(JSON.parse(localRows));
            } catch { }
        }
    };

    // Initial load and external storage sync
    useEffect(() => {
        // Load allotments (Classes Alloted tab)
        loadAllotments();
        // Load Streams
        loadStreams();
        // Load Teachers & Subjects from cloud
        loadDptData();

        // Listen for storage changes from other tabs
        const handleExternalStorageChange = (e) => {
            if (e.key === 'tt_allotments') {
                const localSaved = localStorage.getItem('tt_allotments');
                if (localSaved) {
                    const data = JSON.parse(localSaved);
                    if (data.rows) setAllotmentRows(data.rows);
                }
            }
        };
        window.addEventListener('storage', handleExternalStorageChange);
        return () => window.removeEventListener('storage', handleExternalStorageChange);
    }, []);

    // Tab 3 (Mappings) State
    const [teacherSubjectMappings, setTeacherSubjectMappings] = useState(() => {
        const saved = localStorage.getItem('tt_mappings');
        return saved ? JSON.parse(saved) : [];
    });
    const [selectedMappingFile, setSelectedMappingFile] = useState(null);
    const [isUploadingMapping, setIsUploadingMapping] = useState(false);
    const [mappingError, setMappingError] = useState(null);

    // UI State for Grid Dropdown
    const [dropdownConfig, setDropdownConfig] = useState(null); // { mappingId, slotIndex, rect }
    const [academicYear, setAcademicYear] = useState('2026-2027');
    const [hasNewExtraction, setHasNewExtraction] = useState(() => {
        return localStorage.getItem('tt_lock') === 'true';
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [currentVersion, setCurrentVersion] = useState(null);
    const [generatedTimetable, setGeneratedTimetable] = useState(() => {
        const saved = localStorage.getItem('tt_generated_timetable');
        return saved ? JSON.parse(saved) : null;
    });
    const [isGenerating, setIsGenerating] = useState(false);

    // --- Change Tracking State ---
    const [baselineTimetable, setBaselineTimetable] = useState(() => {
        const saved = localStorage.getItem('tt_baseline_timetable');
        return saved ? JSON.parse(saved) : (localStorage.getItem('tt_generated_timetable') ? JSON.parse(localStorage.getItem('tt_generated_timetable')) : null);
    });
    const [timetableChanges, setTimetableChanges] = useState({ diffs: [], count: 0 });
    const [showChangesOnly, setShowChangesOnly] = useState(false);
    const [highlightTeacher, setHighlightTeacher] = useState(null);

    // Track changes when timetable updates
    useEffect(() => {
        if (baselineTimetable && generatedTimetable) {
            const diffs = [];
            const classes = Object.keys(generatedTimetable.classTimetables || {});
            classes.forEach(cls => {
                const days = Object.keys(generatedTimetable.classTimetables[cls] || {});
                days.forEach(day => {
                    const periods = Object.keys(generatedTimetable.classTimetables[cls][day] || {});
                    periods.forEach(p => {
                        // Skip non-teaching slots (S3, S7 etc are fixed BREAKS in UI rendering mostly, but check data)
                        const oldSlot = baselineTimetable.classTimetables?.[cls]?.[day]?.[p];
                        const newSlot = generatedTimetable.classTimetables?.[cls]?.[day]?.[p];

                        if (!oldSlot && !newSlot) return;

                        const oldS = oldSlot?.subject || '';
                        const oldT = oldSlot?.teacher || '';
                        const newS = newSlot?.subject || '';
                        const newT = newSlot?.teacher || '';

                        if (oldS !== newS || oldT !== newT) {
                            diffs.push({
                                class: cls,
                                day: day,
                                period: p,
                                old: { subject: oldS, teacher: oldT },
                                new: { subject: newS, teacher: newT }
                            });
                        }
                    });
                });
            });
            setTimetableChanges({ diffs, count: diffs.length });
        } else {
            setTimetableChanges({ diffs: [], count: 0 });
        }
    }, [generatedTimetable, baselineTimetable]);

    // Tab 3 - Manual entry states
    const [showNewTeacherInput, setShowNewTeacherInput] = useState(null);
    const [showNewSubjectInput, setShowNewSubjectInput] = useState(null);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newSubjectName, setNewSubjectName] = useState('');
    const [activeSubjectMappingId, setActiveSubjectMappingId] = useState(null);

    // Tab 4 (Distribution) State - 47 COLUMN VERSION
    const [distribution47, setDistribution47] = useState(loadDistribution());
    const [editingCell, setEditingCell] = useState(null);
    const [editValue, setEditValue] = useState('');
    // we maintain both per-cell selection for merging and a simple class list for bulk edits
    const [selectedClasses, setSelectedClasses] = useState([]);
    const [selectedCells, setSelectedCells] = useState([]); // {subject,className}
    const selectedCellsRef = useRef([]); // mirror to avoid stale state when toggling fast
    const [selectedSubjects, setSelectedSubjects] = useState(new Set());
    const [currentBulkSubject, setCurrentBulkSubject] = useState(null);
    const [bulkPeriodValue, setBulkPeriodValue] = useState('5');
    const [lastSelectedClass, setLastSelectedClass] = useState(null);
    // merge UI state (no longer needed separate prompt state)
    // const [showMergePrompt, setShowMergePrompt] = useState(false);
    // drag-selection state
    const [mouseDown, setMouseDown] = useState(false);
    // flag to remember if last mouse down was a ctrl-selection
    const ctrlSelecting = useRef(false);
    const statusScrollRef = useRef(null); // ref for status panel auto-scroll
    const [editingSubjectName, setEditingSubjectName] = useState(null);
    const [subjectRenameValue, setSubjectRenameValue] = useState('');
    const [allotmentFilterPriority, setAllotmentFilterPriority] = useState(false);

    // helper to toggle ctrl-selection (used by mouse events)
    const toggleCtrlSelect = (subject, className) => {
        if (isClassMerged(distribution47, subject, className)) return;
        // also maintain selectedClasses list for bulk editing
        setSelectedClasses(prev => {
            if (prev.includes(className)) {
                return prev.filter(c => c !== className);
            } else {
                return [...prev, className];
            }
        });
        // update ref for immediate consistency
        let newList;
        if (currentBulkSubject && currentBulkSubject !== subject) {
            newList = [{ subject, className }];
            setCurrentBulkSubject(subject);
        } else {
            const exists = selectedCellsRef.current.find(c => c.subject === subject && c.className === className);
            if (exists) {
                newList = selectedCellsRef.current.filter(c => !(c.subject === subject && c.className === className));
            } else {
                newList = [...selectedCellsRef.current, { subject, className }];
            }
            setCurrentBulkSubject(subject);
        }
        selectedCellsRef.current = newList;
        setSelectedCells(newList);
    };

    useEffect(() => {
        const onGlobalMouseUp = () => {
            setMouseDown(false);
            ctrlSelecting.current = false;
        };
        window.addEventListener('mouseup', onGlobalMouseUp);
        return () => window.removeEventListener('mouseup', onGlobalMouseUp);
    }, []);
    // Tab 1: Subject Streams (Parallel Classes) State
    const [subjectStreams, setSubjectStreams] = useState([]);
    const [showStreamModal, setShowStreamModal] = useState(false);
    const [editingStreamId, setEditingStreamId] = useState(null);
    const [streamForm, setStreamForm] = useState({
        name: '',
        abbreviation: '',
        className: '6A',
        periods: 4,
        subjects: [{ teacher: '', subject: '', groupName: '', labGroup: 'None', targetLabCount: 2 }]
    });

    // toast messages
    const [toasts, setToasts] = useState([]);
    const addToast = (msg, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, type === 'success' ? 6000 : 4000);
    };

    // Tab 5 (Bell Timings) State
    const [bellTimings, setBellTimings] = useState({
        middleSchool: {
            CT: '8:00-8:35',
            S1: '8:35-9:15',
            S2: '9:15-9:55',
            S3: '9:55-10:10', // Break 1
            S4: '10:10-10:50',
            S5: '10:50-11:30',
            S6: '11:30-12:10',
            S7: '12:10-12:20', // Break 2
            S8: '12:20-13:00',
            S9: '13:00-13:30', // Lunch
            S10: '13:30-14:05',
            S11: '14:05-14:55'
        },
        seniorSchool: {
            CT: '8:00-8:35',
            S1: '8:35-9:15',
            S2: '9:15-9:55',
            S3: '9:55-10:10', // Break 1
            S4: '10:10-10:50',
            S5: '10:50-11:30',
            S6: '11:30-12:10',
            S7: '12:10-12:20', // Break 2
            S8: '12:20-13:00',
            S9: '13:00-13:30', // Period 7
            S10: '13:30-14:05', // Lunch
            S11: '14:05-14:55'
        }
    });

    // --- Authentication Flow (Auto-Anonymous) ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                console.log(`[Auth] User detected: ${user.isAnonymous ? 'Anonymous' : user.email} (UID: ${user.uid})`);
            } else {
                console.log('[Auth] No user. Attempting anonymous sign-in...');
                signInAnonymously(auth)
                    .then(() => console.log('[Auth] Signed in anonymously'))
                    .catch(err => console.error('[Auth] Anon login failed:', err));
            }
        });
        return () => unsubscribe();
    }, []);

    // --- Local Persistence (instant localStorage on every change) ---
    useEffect(() => {
        localStorage.setItem('tt_mappings', JSON.stringify(teacherSubjectMappings));
        localStorage.setItem('tt_subjects', JSON.stringify(subjects));
        localStorage.setItem('tt_teachers', JSON.stringify(teachers));
        localStorage.setItem('tt_lock', hasNewExtraction.toString());
        localStorage.setItem('tt_active_tab', activeTab.toString());
    }, [teacherSubjectMappings, subjects, teachers, hasNewExtraction, activeTab]);

    // --- Auto-save allotmentRows to cloud (debounced 3s) ---
    useEffect(() => {
        if (!allotmentRows || allotmentRows.length === 0) return;
        const timer = setTimeout(() => {
            // silent save: write to localStorage + Firestore without toast
            try { localStorage.setItem('tt_allotments', JSON.stringify({ rows: allotmentRows })); } catch { }
            const docRef = doc(db, 'allotments', academicYear);
            setDoc(docRef, { rows: allotmentRows, lastUpdated: new Date().toISOString(), academicYear })
                .then(() => console.log('☁️ [AutoSave] allotments synced'))
                .catch(e => console.warn('⚠️ [AutoSave] allotments cloud failed:', e.message));
        }, 3000);
        return () => clearTimeout(timer);
    }, [allotmentRows]);

    // --- Auto-save Teachers & Subjects to cloud (debounced 3s) ---
    useEffect(() => {
        if (!mappingRows || mappingRows.length === 0) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem('tt_mapping_rows', JSON.stringify(mappingRows));
                localStorage.setItem('tt_teachers', JSON.stringify(teachers));
                localStorage.setItem('tt_subjects', JSON.stringify(subjects));
            } catch { }
            const docRef = doc(db, 'dpt_data', academicYear);
            setDoc(docRef, {
                mappingRows, teachers, subjects,
                lastUpdated: new Date().toISOString(), academicYear
            })
                .then(() => console.log('☁️ [AutoSave] dpt_data synced'))
                .catch(e => console.warn('⚠️ [AutoSave] dpt_data cloud failed:', e.message));
        }, 3000);
        return () => clearTimeout(timer);
    }, [mappingRows, teachers, subjects]);

    // Sort mappings whenever list length changes (e.g. initial load from localStorage)
    useEffect(() => {
        if (teacherSubjectMappings.length > 0) {
            const isSorted = teacherSubjectMappings.every((m, i, arr) =>
                i === 0 || arr[i - 1].teacher <= m.teacher
            );

            if (!isSorted) {
                const sortedMappings = [...teacherSubjectMappings]
                    .sort((a, b) => a.teacher.localeCompare(b.teacher))
                    .map((mapping, index) => ({
                        ...mapping,
                        id: index + 1
                    }));
                setTeacherSubjectMappings(sortedMappings);
            }
        }
    }, [teacherSubjectMappings.length]);

    // Auto-sync: When Tab 3 mappings change, update Tab 4 subjects
    useEffect(() => {
        console.log('🔄 Tab 3 mappings changed, checking sync...');

        if (teacherSubjectMappings && teacherSubjectMappings.length > 0) {
            console.log(`Processing ${teacherSubjectMappings.length} mappings for sync`);

            // Get current distribution
            const currentDist = distribution47 || loadDistribution();

            // Sync subjects from mappings
            const updatedDistribution = syncSubjectsFromMappings(
                { ...currentDist },
                teacherSubjectMappings
            );

            // Check if anything changed
            const currentStr = JSON.stringify(currentDist);
            const updatedStr = JSON.stringify(updatedDistribution);

            if (currentStr !== updatedStr) {
                console.log('✅ Distribution updated, saving...');
                setDistribution47(updatedDistribution);
                saveDistribution(updatedDistribution);
            } else {
                console.log('No changes needed');
            }
        } else {
            console.log('No mappings to sync');
        }
    }, [teacherSubjectMappings]); // Run whenever mappings change

    // Debug: Log when distribution changes
    useEffect(() => {
        console.log('📊 Distribution updated. Subjects:', getAllSubjects(distribution47));
    }, [distribution47]);

    const loadMappingsForYear = async (year, force = false) => {
        if (!year) return;

        // PROTECTION: If we have newly extracted data that hasn't been saved, don't overwrite it unless forced
        if (hasNewExtraction && !force) {
            console.log('[Lock] Skipping auto-load to protect unsaved extraction data');
            return;
        }

        setIsLoading(true);

        try {
            const result = await loadTimetableMappings(year);

            if (result.mappings && result.mappings.length > 0) {
                // SORT MAPPINGS ALPHABETICALLY BY TEACHER NAME
                const sortedMappings = [...result.mappings].sort((a, b) =>
                    a.teacher.localeCompare(b.teacher)
                ).map((mapping, index) => ({
                    ...mapping,
                    id: index + 1
                }));

                setTeacherSubjectMappings(sortedMappings);
                setCurrentVersion(result.version);

                // After loading mappings, sync subjects to distribution
                const updatedDistribution = syncSubjectsFromMappings(
                    loadDistribution(), // Get current saved distribution
                    sortedMappings
                );
                setDistribution47(updatedDistribution);
                saveDistribution(updatedDistribution);

                console.log(`✅ Loaded ${result.mappings.length} mappings for ${year} (sorted alphabetically)`);
            } else {
                setTeacherSubjectMappings([]);
                setCurrentVersion(null);
                console.log(`No mappings found for ${year}`);
            }
        } catch (error) {
            console.error('Load error:', error);
            // Don't show alert on auto-load, just console
        } finally {
            setIsLoading(false);
        }
    };


    useEffect(() => {
        // AUTO-LOAD POLICY:
        // Only trigger auto-load if:
        // 1. We are on the Mapping Tab
        // 2. We don't have newly extracted data (hasNewExtraction is false)
        // 3. The current list is empty
        if (activeTab === 3 && !hasNewExtraction && teacherSubjectMappings.length === 0) {
            // preserve previous behaviour: trigger when Format TT becomes active
            console.log(`[AutoLoad] Triggering load for ${academicYear} (Reason: Format TT tab active, List empty, No fresh extraction)`);
            loadMappingsForYear(academicYear);
        } else if (activeTab === 2) {
            console.log(`[AutoLoad] Blocked. state: {hasNewExtraction: ${hasNewExtraction}, listLength: ${teacherSubjectMappings.length}}`);
        }
    }, [activeTab, academicYear, hasNewExtraction, teacherSubjectMappings.length]);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            setSelectedFile(file);
            setErrorStatus(null);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsUploading(true);
        setUploadedFileName(file.name);
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target.result;
            const rows = text.split('\n').map(r => r.trim()).filter(r => r);
            const grouped = {};
            const subjectSet = new Set();
            for (const r of rows) {
                const [teacher, subject, level] = r.split(',').map(x => x.trim());
                if (!teacher || !subject) continue;

                if (!grouped[teacher]) {
                    grouped[teacher] = {
                        id: Date.now() + Math.random(),
                        teacher,
                        subjects: [],
                        level: level || 'Main'
                    };
                }
                if (!grouped[teacher].subjects.includes(subject)) {
                    grouped[teacher].subjects.push(subject);
                }
                subjectSet.add(subject);
            }
            const finalMappingRows = Object.values(grouped);
            setTeachers(finalMappingRows.map(m => m.teacher).sort());
            setSubjects(Array.from(subjectSet).sort());
            setMappingRows(finalMappingRows);
            setIsUploading(false);
        };
        reader.readAsText(file);
    };

    const handleMappingFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            setSelectedMappingFile(file);
            setMappingError(null);
        }
    };

    const handleMappingUpload = async () => {
        if (!selectedMappingFile) return;
        setIsUploadingMapping(true);
        try {
            const result = await extractSubjectsFromPDF(selectedMappingFile);
            setIsUploadingMapping(false);

            if (result.teachers && result.teachers.length > 0) {
                setTeachers(prev => Array.from(new Set([...prev, ...result.teachers])).sort());
            }

            if (result.mappings && result.mappings.length > 0) {
                setTeacherSubjectMappings(prev => {
                    const map = new Map(prev.map(m => [`${m.teacher}-${m.subject}`, m]));
                    result.mappings.forEach(newM => {
                        const key = `${newM.teacher}-${newM.subject}`;
                        if (map.has(key)) {
                            const existing = map.get(key);
                            const combinedClasses = Array.from(new Set([...existing.classes, ...newM.classes])).sort((a, b) => parseInt(a) - parseInt(b));
                            map.set(key, { ...existing, classes: combinedClasses });
                        } else {
                            // Use a more unique ID to avoid React key collisions
                            map.set(key, { ...newM, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` });
                        }
                    });
                    return Array.from(map.values()).sort((a, b) => a.teacher.localeCompare(b.teacher));
                });
                setHasNewExtraction(true); // LOCK STATE: Prevent auto-reloads from overwriting this list
                // Sync subjects to distribution will happen automatically via useEffect
                addToast(`✅ Extracted ${result.mappings.length} mappings!\n\n✅ Subjects auto-synced to Period Distribution tab!`, 'success');
            } else {
                setMappingError("No teacher-subject-class mappings found.");
            }
            setSelectedMappingFile(null);
        } catch (error) {
            setIsUploadingMapping(false);
            setMappingError(error.message);
        }
    };

    const handleSetGrade = (mappingId, slotIndex, grade) => {
        setTeacherSubjectMappings(prev => prev.map(m => {
            if (m.id === mappingId) {
                const newClasses = [...m.classes];
                if (grade === null) {
                    newClasses.splice(slotIndex, 1);
                } else {
                    newClasses[slotIndex] = grade;
                }
                const cleaned = Array.from(new Set(newClasses.filter(Boolean))).sort((a, b) => parseInt(a) - parseInt(b));
                return { ...m, classes: cleaned };
            }
            return m;
        }));
        setDropdownConfig(null);
    };

    const handleUpdateSubject = (mappingId, newSub) => {
        setTeacherSubjectMappings(prev => prev.map(m =>
            m.id === mappingId ? { ...m, subject: newSub } : m
        ));
    };

    const handleUpdateTeacher = (mappingId, newTeacher) => {
        setTeacherSubjectMappings(prev => prev.map(m =>
            m.id === mappingId ? { ...m, teacher: newTeacher } : m
        ));
    };

    const handleAddMappingLine = () => {
        const newLine = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            teacher: '',
            subject: '',
            classes: []
        };
        // Add new line and sort — empty teacher names go to end
        const updatedMappings = [...teacherSubjectMappings, newLine]
            .sort((a, b) => {
                if (!a.teacher) return 1;
                if (!b.teacher) return -1;
                return a.teacher.localeCompare(b.teacher);
            })
            .map((mapping, index) => ({
                ...mapping,
                id: typeof mapping.id === 'number' ? index + 1 : mapping.id
            }));
        setTeacherSubjectMappings(updatedMappings);
    };

    // ============ TAB 4 HANDLERS ============

    const handleSelectAll = () => {
        if (selectedClasses.length === ALL_CLASSES.length) {
            setSelectedClasses([]);
        } else {
            setSelectedClasses([...ALL_CLASSES]);
        }
        setSelectedCells([]);
    };

    const handleSubjectSelect = (subject) => {
        const newSelected = new Set(selectedSubjects);
        if (newSelected.has(subject)) {
            newSelected.delete(subject);
            if (currentBulkSubject === subject) setCurrentBulkSubject(null);
        } else {
            newSelected.add(subject);
            setCurrentBulkSubject(subject);
        }
        setSelectedSubjects(newSelected);
    };

    const handleGradeBulk = (grade) => {
        const gradeClasses = ALL_CLASSES.filter(cls => cls.startsWith(grade));
        setSelectedClasses(gradeClasses);
        setSelectedCells([]);
    };

    const handleBulkApply = () => {
        if (!currentBulkSubject) {
            addToast('Please select a subject first by clicking on it', 'warning');
            return;
        }

        if (selectedClasses.length === 0) {
            addToast('Please select at least one class', 'warning');
            return;
        }

        const value = parseInt(bulkPeriodValue) || 0;
        let updated = { ...distribution47 };
        updated = setBulkValues(updated, currentBulkSubject, selectedClasses, value);
        setDistribution47(updated);
        saveDistribution(updated);

        addToast(`✅ Set ${currentBulkSubject} to ${value} periods for ${selectedClasses.length} classes`, 'success');
    };

    const handleSaveMappings = async () => {
        if (teacherSubjectMappings.length === 0) {
            addToast('No mappings to save', 'warning');
            return;
        }

        setIsSaving(true);

        try {
            const user = auth.currentUser;
            const createdBy = user?.email || user?.displayName || 'admin';

            console.log(`[Save] Starting save of ${teacherSubjectMappings.length} mappings...`);
            const result = await saveTimetableMappings(teacherSubjectMappings, academicYear, createdBy);
            console.log('[Save] Firestore confirmed save:', result);

            addToast(`✅ Successfully saved ${teacherSubjectMappings.length} mappings!\nVersion ID: ${result.versionId}\nAcademic Year: ${academicYear}`, 'success');

            // UNLOCK & RELOAD
            setHasNewExtraction(false);
            localStorage.removeItem('tt_lock');
            localStorage.removeItem('tt_mappings');
            await loadMappingsForYear(academicYear, true);
        } catch (error) {
            console.error('[Save] Error:', error);
            addToast(`❌ Failed to save mappings: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePublishVersion = async () => {
        if (!currentVersion?.id) {
            addToast('No version selected to publish', 'warning');
            return;
        }

        if (!generatedTimetable) {
            addToast('⚠️ Please generate timetable first before publishing', 'warning');
            return;
        }

        if (!confirm(`📱 PUBLISH TIMETABLE TO ALL TEACHERS?

Academic Year: ${academicYear}
Version: ${currentVersion.version}
Teachers: ${Object.keys(generatedTimetable.teacherTimetables).length}
Classes: 47

This will:
• Set as ACTIVE timetable
• Send PUSH NOTIFICATION to all teachers
• Update teacher APKs immediately

Proceed?`)) {
            return;
        }

        setIsPublishing(true);

        try {
            // 1. Update version status to active
            await publishTimetableVersion(currentVersion.id);

            // 2. Push to APK with full timetable data and bell timings
            const result = await publishTimetableToAPK(
                currentVersion.id,
                academicYear,
                generatedTimetable.classTimetables,
                generatedTimetable.teacherTimetables,
                bellTimings
            );

            // 3. Update local state
            setCurrentVersion({
                ...currentVersion,
                status: 'active'
            });

            // 4. Show success with APK confirmation
            addToast(`✅ TIMETABLE PUBLISHED SUCCESSFULLY!
📅 Academic Year: ${academicYear}
🏷️ Version: ${currentVersion.version}
👩‍🏫 Teachers: ${result.teacherCount}
🏫 Classes: 47
📱 Push notifications: SENT to all teachers

Teachers can now see their timetable in the AutoSubs app.`, 'success');

            // 5. Optional: Show preview of what teachers see
            const firstTeacher = Object.keys(generatedTimetable.teacherTimetables)[0];
            if (firstTeacher) {
                console.log('📱 Sample teacher data for APK:', {
                    teacher: firstTeacher,
                    monday: generatedTimetable.teacherTimetables[firstTeacher]?.Monday
                });
            }
        } catch (error) {
            console.error('Publish error:', error);
            addToast(`❌ Failed to publish: ${error.message}`, 'error');
        } finally {
            setIsPublishing(false);
        }
    };


    const handleCreateStreamSpecific = async (stream, baseTT = null) => {
        if (!stream.name || !stream.className || !stream.subjects || stream.subjects.length === 0) {
            addToast('Stream details incomplete', 'warning');
            return null;
        }

        console.log('🟢 [STREAM CREATE] Clicked for:', stream.name, stream.className);

        let currentTT = baseTT || generatedTimetable;
        if (!currentTT) {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const initPeriods = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];
            const cTimetables = {};
            const tTimetables = {};

            CLASS_OPTIONS.forEach(cn => {
                cTimetables[cn] = {};
                days.forEach(d => {
                    cTimetables[cn][d] = {};
                    initPeriods.forEach(p => { cTimetables[cn][d][p] = { subject: '', teacher: '' }; });
                });
            });

            const allTeachers = [...new Set(allotmentRows.map(r => r.teacher?.trim()).filter(Boolean))];
            allTeachers.forEach(t => {
                const trimmedT = t.trim();
                tTimetables[trimmedT] = {};
                days.forEach(d => {
                    tTimetables[trimmedT][d] = { CT: 'CT', S1: '', S2: '', S3: 'BREAK', S4: '', S5: '', S6: '', S7: 'BREAK', S8: '', S9: '', S10: '', S11: '', periodCount: 0 };
                });
                tTimetables[trimmedT].weeklyPeriods = 0;
            });

            currentTT = { classTimetables: cTimetables, teacherTimetables: tTimetables, academicYear, bellTimings };
        }

        setCreationStatus({
            teacher: 'STREAM', subject: stream.name,
            messages: [
                `═══════════════════════════════════════`,
                `CREATING STREAM: ${stream.name} (${stream.className})`,
                `═══════════════════════════════════════`
            ],
            progress: 0, completedCount: completedCreations.size + 1, isError: false
        });

        const addMessage = (msg) => setCreationStatus(prev => ({
            ...prev, messages: [...(prev?.messages || []), msg]
        }));
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            const tt = JSON.parse(JSON.stringify(currentTT));
            const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const PRDS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

            // Level determination
            const isMiddle = parseInt(stream.className) < 11;
            const AVAILABLE_SLOTS = isMiddle
                ? ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S10', 'S11']
                : ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S11'];

            const tFree = (teacherInput, d, p) => {
                const teacher = teacherInput?.trim();
                if (!tt.teacherTimetables[teacher]) {
                    tt.teacherTimetables[teacher] = { weeklyPeriods: 0 };
                    DAYS.forEach(day => {
                        tt.teacherTimetables[teacher][day] = { CT: 'CT', S1: '', S2: '', S3: 'BREAK', S4: '', S5: '', S6: '', S7: 'BREAK', S8: '', S9: '', S10: '', S11: '', periodCount: 0 };
                    });
                }
                const sl = tt.teacherTimetables[teacher][d][p];
                return sl === '' || sl === undefined || sl === null;
            };

            const streamFree = (d, p) => {
                const classFree = (tt.classTimetables[stream.className]?.[d]?.[p]?.subject ?? '') === '';
                const teachersFree = stream.subjects.every(s => tFree(s.teacher, d, p));

                // Lab conflict check (Global)
                let labConflict = false;
                for (const s of stream.subjects) {
                    if (s.labGroup && s.labGroup !== 'None') {
                        if (detectLabConflict(tt.classTimetables, stream.className, d, p, s.labGroup)) {
                            labConflict = true;
                            break;
                        }
                    }
                }

                return classFree && teachersFree && !labConflict;
            };

            const periodsToPlace = Number(stream.periods) || 0;
            let placed = 0;
            const placements = [];

            addMessage(`→ Placing ${periodsToPlace} periods for stream ${stream.name}`);

            // Diagonal walk for distribution
            // Exclude Saturday for streams as requested
            const PRIORITY_DAYS = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];

            // Start from a random day to ensure rotation
            const rotationOffset = Math.floor(Math.random() * PRIORITY_DAYS.length);
            const ROTATED_DAYS = [
                ...PRIORITY_DAYS.slice(rotationOffset),
                ...PRIORITY_DAYS.slice(0, rotationOffset)
            ];

            // Count already-placed STREAM periods in TT globally
            let existingStreamCount = 0;
            for (const cn of Object.keys(tt.classTimetables)) {
                for (const d of DAYS) {
                    for (const p of PRDS) {
                        if (tt.classTimetables[cn][d][p]?.isStream) existingStreamCount++;
                    }
                }
            }

            const D_LEN = ROTATED_DAYS.length;
            const P_LEN = AVAILABLE_SLOTS.length;

            for (let i = 0; i < stream.periods; i++) {
                let pick = null;
                // Walk DIAGONALLY (incrementing both day and period)
                for (let attempt = 0; attempt < D_LEN * P_LEN; attempt++) {
                    const walkIdx = existingStreamCount + i + attempt;
                    const d = ROTATED_DAYS[walkIdx % D_LEN];
                    const p = AVAILABLE_SLOTS[walkIdx % P_LEN];

                    if (placements.some(placement => placement.day === d)) continue;

                    if (streamFree(d, p)) {
                        pick = { d, p };
                        break;
                    }
                }

                if (!pick) {
                    // Fallback: ignore same-day constraint but keep diagonal walk
                    for (let attempt = 0; attempt < D_LEN * P_LEN; attempt++) {
                        const walkIdx = existingStreamCount + i + attempt;
                        const d = ROTATED_DAYS[walkIdx % D_LEN];
                        const p = AVAILABLE_SLOTS[walkIdx % P_LEN];
                        if (streamFree(d, p)) {
                            pick = { d, p };
                            break;
                        }
                    }
                }

                if (pick) {
                    const abbr = stream.abbreviation || getAbbreviation(stream.name);
                    tt.classTimetables[stream.className][pick.d][pick.p] = {
                        subject: abbr,
                        isStream: true,
                        streamName: stream.name,
                        subjects: stream.subjects
                    };

                    stream.subjects.forEach(s => {
                        const trimmedT = s.teacher?.trim();
                        if (!trimmedT) return;
                        const labStatusData = {
                            className: stream.className,
                            subject: s.subject,
                            labGroup: s.labGroup || 'None',
                            targetLabCount: s.targetLabCount
                        };
                        const isLab = determineLabStatus(tt.classTimetables, labStatusData, pick.d, pick.p);

                        tt.teacherTimetables[trimmedT][pick.d][pick.p] = {
                            className: stream.className,
                            subject: s.subject,
                            fullSubject: s.subject,
                            groupName: s.groupName,
                            isStream: true,
                            streamName: stream.name,
                            labGroup: s.labGroup || 'None',
                            targetLabCount: s.targetLabCount,
                            isLabPeriod: isLab
                        };

                        // Also update class timetable slot with the first subject's lab info for display
                        // In streams, all subjects usually share the same lab/theory status if they are in the same stream
                        // but we'll store it on the class slot as well
                        if (!tt.classTimetables[stream.className][pick.d][pick.p].labGroup) {
                            tt.classTimetables[stream.className][pick.d][pick.p].labGroup = s.labGroup || 'None';
                            tt.classTimetables[stream.className][pick.d][pick.p].isLabPeriod = isLab;
                        }

                        tt.teacherTimetables[trimmedT][pick.d].periodCount++;
                        tt.teacherTimetables[trimmedT].weeklyPeriods++;
                    });

                    placements.push(pick);
                    placed++;
                    addMessage(`✅ Placed ${placed}/${periodsToPlace}: ${pick.d} ${pick.p}`);
                    await sleep(100);
                } else {
                    addMessage(`❌ Failed to find slot for period ${i + 1}`);
                    setCreationStatus(prev => ({ ...prev, isError: true }));
                    return null;
                }
            }

            if (placed === periodsToPlace) {
                const finalTT = syncLabTimetables(tt);
                setGeneratedTimetable(finalTT);
                setCompletedCreations(prev => new Set([...prev, stream.id]));
                setCreationStatus(null);
                return tt;
            }
            return null;

        } catch (err) {
            console.error(err);
            addMessage(`❌ ERROR: ${err.message}`);
            return null;
        }
    };

    const handleCreateSpecific = async (row, baseTT = null, isBatch = false) => {
        if (!row.teacher) {
            addToast('Teacher must be selected', 'warning');
            return null;
        }

        console.log('🟢 [CREATE] Clicked for:', row.teacher, row.allotments);

        // ── Build or reuse working timetable ───────────────────────────────────
        let currentTT = baseTT || generatedTimetable;
        console.log('🟡 [CREATE] Existing generatedTimetable:', currentTT ? 'exists' : 'null - building fresh');
        if (!currentTT) {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const initPeriods = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];
            const cTimetables = {};
            const tTimetables = {};
            const allTeachers = [...new Set(allotmentRows.map(r => r.teacher?.trim()).filter(Boolean))];

            CLASS_OPTIONS.forEach(cn => {
                cTimetables[cn] = {};
                days.forEach(d => {
                    cTimetables[cn][d] = {};
                    initPeriods.forEach(p => { cTimetables[cn][d][p] = { subject: '', teacher: '' }; });
                });
            });

            allTeachers.forEach(t => {
                const trimmedT = t.trim();
                tTimetables[trimmedT] = {};
                days.forEach(d => {
                    tTimetables[trimmedT][d] = { CT: 'CT', S1: '', S2: '', S3: 'BREAK', S4: '', S5: '', S6: '', S7: 'BREAK', S8: '', S9: '', S10: '', S11: '', periodCount: 0 };
                });
                tTimetables[trimmedT].weeklyPeriods = 0;
            });

            currentTT = { classTimetables: cTimetables, teacherTimetables: tTimetables, academicYear, bellTimings };
        }

        setCreationStatus(prev => ({
            ...(prev || {}),
            teacher: row.teacher, subject: 'Multiple subjects...',
            messages: [
                `═══════════════════════════════════════`,
                `CREATING: ${row.teacher}`,
                `═══════════════════════════════════════`
            ],
            progress: 0, completedCount: completedCreations.size + 1, isError: false
        }));

        const addMessage = (msg) => setCreationStatus(prev => ({
            ...prev, messages: [...(prev?.messages || []), msg]
        }));
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            const teacher = row.teacher?.trim();

            // ── Build tasks list ────────────────────────────────────────────────
            const tasks = [];
            row.allotments.forEach(group => {
                const total = Number(group.periods) || 0;
                const totalRequestedTB = Number(group.tBlock) || 0;
                const totalRequestedLB = Number(group.lBlock) || 0;

                // Calculate blocks based on requested periods (e.g. 2 periods = 1 block)
                const tBlocksCount = Math.floor(totalRequestedTB / 2);
                const lBlocksCount = Math.floor(totalRequestedLB / 2);
                const singles = Math.max(0, total - (tBlocksCount * 2) - (lBlocksCount * 2));

                const pDay = group.preferredDay || 'Any';

                // When creating tasks, we pass the totalRequestedLB to the engine
                const taskMetadata = {
                    teacher,
                    subject: group.subject,
                    classes: group.classes,
                    preferredDay: pDay,
                    labGroup: group.labGroup || 'None',
                    targetLabCount: totalRequestedLB
                };

                for (let i = 0; i < tBlocksCount; i++) tasks.push({ ...taskMetadata, type: 'TBLOCK' });
                for (let i = 0; i < lBlocksCount; i++) tasks.push({ ...taskMetadata, type: 'LBLOCK', preferredDay: 'Any' });
                for (let i = 0; i < singles; i++) tasks.push({ ...taskMetadata, type: 'SINGLE' });
            });

            if (tasks.length === 0) {
                addMessage(`→ No periods set for ${row.teacher}. Skipping.`);
                await sleep(500);
                return currentTT; // Return existing TT to continue batch
            }

            const tBlockTasks = tasks.filter(t => t.type === 'TBLOCK');
            const lBlockTasks = tasks.filter(t => t.type === 'LBLOCK');
            const singleTasks = tasks.filter(t => t.type === 'SINGLE');

            addMessage(`→ ${tasks.length} total periods:`);
            if (tBlockTasks.length > 0) addMessage(`   • ${tBlockTasks.length} Theory Block(s) [T]`);
            if (lBlockTasks.length > 0) addMessage(`   • ${lBlockTasks.length} Lab Block(s) [L]`);
            if (singleTasks.length > 0) addMessage(`   • ${singleTasks.length} Single Period(s)`);
            await sleep(300);

            // ── Constants ───────────────────────────────────────────────────────
            const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const DMAP = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
            const SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
            const PRDS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

            // ── Teacher Availability Logic ────────────────────────────────────
            const teacherMapping = mappingRows.find(m => m.teacher === teacher);
            const levelStr = teacherMapping?.level || 'Main';
            const isMiddle = levelStr.includes('Middle');

            // Exclude Breaks (S3, S7) and Lunch (S9 for Middle, S10 for Main)
            const AVAILABLE_SLOTS = isMiddle
                ? ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S10', 'S11']
                : ['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S11'];

            // Block pairs that do NOT cross any break or lunch
            const VALID_BLOCK_PAIRS = isMiddle
                ? [['S1', 'S2'], ['S4', 'S5'], ['S5', 'S6'], ['S10', 'S11']]
                : [['S1', 'S2'], ['S4', 'S5'], ['S5', 'S6'], ['S8', 'S9']];

            // Deep-copy — commit only on full success
            const tt = JSON.parse(JSON.stringify(currentTT));

            // Ensure teacher row exists
            if (!tt.teacherTimetables[teacher]) {
                tt.teacherTimetables[teacher] = { weeklyPeriods: 0 };
                DAYS.forEach(d => {
                    tt.teacherTimetables[teacher][d] = { CT: 'CT', S1: '', S2: '', S3: 'BREAK', S4: '', S5: '', S6: '', S7: 'BREAK', S8: '', S9: '', S10: '', S11: '', periodCount: 0 };
                });
            }

            // ── Helpers ─────────────────────────────────────────────────────────
            const tFree = (d, p) => {
                const sl = tt.teacherTimetables[teacher]?.[d]?.[p];
                if (sl === undefined || sl === null || sl === '') return true;
                if (typeof sl === 'object') return !sl.className;
                return false;
            };
            const cFree = (d, p, classes) =>
                classes.every(cn => (tt.classTimetables[cn]?.[d]?.[p]?.subject ?? '') === '');

            const labFree = (d, p, classes, labGroup, subject) => {
                if (labGroup === 'None') return true;
                return !classes.some(cn => detectLabConflict(tt.classTimetables, cn, d, p, labGroup, subject));
            };

            const slotFree = (d, p, classes, labGroup = 'None', subject = '') =>
                AVAILABLE_SLOTS.includes(p) && tFree(d, p) && cFree(d, p, classes) && labFree(d, p, classes, labGroup, subject);
            const teacherDayLoad = (d) => AVAILABLE_SLOTS.filter(p => !tFree(d, p)).length;

            // Returns true if the given day already has ANY block period for these classes
            // (prevents two consecutive block pairs landing on the same day)
            const dayAlreadyHasBlock = (d, classes) =>
                PRDS.some(p =>
                    classes.some(cn => {
                        const slot = tt.classTimetables[cn]?.[d]?.[p];
                        return slot && slot.isBlock;
                    })
                );

            // ── Scoring: flat across all periods; diversity-weighted ────────────
            // Treats all 8 periods equally in the band, relying on day diversity
            // and consecutive-avoidance to spread them out.
            const scoreSlot = (d, p, classes) => {
                const pIdx = PRDS.indexOf(p);

                // 1. Day Diversity (40) — strong preference for underfilled days
                const loads = DAYS.map(day => teacherDayLoad(day));
                const myLoad = loads[DAYS.indexOf(d)];
                const maxL = Math.max(...loads, 1);
                const s1 = (1 - myLoad / (maxL + 1)) * 40;

                // 2. Period Spread (25) — flat: all periods treated equally
                //    slight edge to middle periods for natural feel
                const midBonus = [0, 0, 0.1, 0.2, 0.25, 0.25, 0.2, 0.1, 0.1, 0, 0];
                const s2 = (0.75 + (midBonus[pIdx] || 0)) * 25;

                // 3. Class Balance (20) — prefer less-loaded class days
                const avgCLoad = classes.reduce((sum, cn) =>
                    sum + AVAILABLE_SLOTS.filter(q => (tt.classTimetables[cn]?.[d]?.[q]?.subject ?? '') !== '').length
                    , 0) / (classes.length || 1);
                const s3 = Math.max(0, 1 - avgCLoad / AVAILABLE_SLOTS.length) * 20;

                // 4. Avoid Consecutive (15) — penalise back-to-back teacher slots
                let penalty = 0;
                if (PRDS[pIdx - 1] && !tFree(d, PRDS[pIdx - 1])) penalty += 7;
                if (PRDS[pIdx + 1] && !tFree(d, PRDS[pIdx + 1])) penalty += 7;
                const s4 = Math.max(0, 15 - penalty);

                return Math.round(s1 + s2 + s3 + s4);
            };

            let placedCount = 0;
            const placements = [];

            // ════════════════════════════════════════════════════════════════════
            // PHASE 1A — THEORY BLOCKS
            //   Prioritize placing these first, often on preferred days.
            // ════════════════════════════════════════════════════════════════════
            if (tBlockTasks.length > 0) {
                const ALL_BLOCK_PAIRS = VALID_BLOCK_PAIRS;
                const PRIORITY_DAYS_B = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];

                let existingBlockPeriods = 0;
                for (const tName of Object.keys(tt.teacherTimetables)) {
                    for (const d of DAYS) {
                        if (!tt.teacherTimetables[tName]?.[d]) continue;
                        for (const p of PRDS) {
                            const sl = tt.teacherTimetables[tName][d][p];
                            if (sl && typeof sl === 'object' && sl.isBlock) existingBlockPeriods++;
                        }
                    }
                }
                const startingBlockIndex = Math.floor(existingBlockPeriods / 2);

                addMessage(`\n🔍 Phase 1A: Placing ${tBlockTasks.length} Theory Block(s)...`);
                await sleep(200);

                for (let bi = 0; bi < tBlockTasks.length; bi++) {
                    const task = tBlockTasks[bi];
                    const globalBlockIdx = startingBlockIndex + bi;
                    const preferredPair = ALL_BLOCK_PAIRS[globalBlockIdx % ALL_BLOCK_PAIRS.length];

                    const baseDays = (task.preferredDay && task.preferredDay !== 'Any')
                        ? [DMAP[task.preferredDay] || task.preferredDay]
                        : PRIORITY_DAYS_B;

                    let best = null;
                    // Step 1: Try preferred pair on available days
                    for (const d of baseDays) {
                        if (dayAlreadyHasBlock(d, task.classes)) continue;
                        if (slotFree(d, preferredPair[0], task.classes, task.labGroup, task.subject) && slotFree(d, preferredPair[1], task.classes, task.labGroup, task.subject)) {
                            best = { d, p1: preferredPair[0], p2: preferredPair[1] };
                            break;
                        }
                    }
                    // Step 2: Fallback to any pair on any day
                    if (!best) {
                        outer_fallback:
                        for (const d of PRIORITY_DAYS_B) {
                            if (dayAlreadyHasBlock(d, task.classes)) continue;
                            for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                                if (slotFree(d, fp1, task.classes, task.labGroup, task.subject) && slotFree(d, fp2, task.classes, task.labGroup, task.subject)) {
                                    best = { d, p1: fp1, p2: fp2 };
                                    break outer_fallback;
                                }
                            }
                        }
                    }

                    if (!best) {
                        addMessage(`✗ No free slot for Theory Block ${bi + 1}!`);
                        setCreationStatus(prev => ({ ...prev, isError: true }));
                        return;
                    }

                    // Commit Theory Block
                    task.classes.forEach(cn => {
                        tt.classTimetables[cn][best.d][best.p1] = { subject: task.subject, teacher, isBlock: true, isTBlock: true };
                        tt.classTimetables[cn][best.d][best.p2] = { subject: task.subject, teacher, isBlock: true, isTBlock: true };
                    });
                    tt.teacherTimetables[teacher][best.d][best.p1] = { className: task.classes.join('/'), subject: task.subject, isBlock: true, isTBlock: true };
                    tt.teacherTimetables[teacher][best.d][best.p2] = { className: task.classes.join('/'), subject: task.subject, isBlock: true, isTBlock: true };
                    tt.teacherTimetables[teacher][best.d].periodCount += 2;
                    tt.teacherTimetables[teacher].weeklyPeriods += 2;

                    placements.push({ day: best.d, period: `${best.p1}-${best.p2}`, type: 'TBLOCK' });
                    addMessage(`✅ Theory Block placed: ${SHORT[best.d]} P${best.p1.replace('S', '')}-P${best.p2.replace('S', '')}`);
                    placedCount++; // One task completed
                    await sleep(150);
                }
            }

            // ════════════════════════════════════════════════════════════════════
            // PHASE 1B — LAB BLOCKS
            //   Must be on different days than Theory blocks if possible.
            // ════════════════════════════════════════════════════════════════════
            if (lBlockTasks.length > 0) {
                const ALL_BLOCK_PAIRS = VALID_BLOCK_PAIRS;
                const PRIORITY_DAYS_B = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];

                addMessage(`\n🔍 Phase 1B: Placing ${lBlockTasks.length} Lab Block(s)...`);
                await sleep(200);

                for (let bi = 0; bi < lBlockTasks.length; bi++) {
                    const task = lBlockTasks[bi];
                    let best = null;

                    // Try to find a day that doesn't have ANY periods for this subject yet (Theory or Lab)
                    const subjectOnDay = (d) =>
                        PRDS.some(p =>
                            task.classes.some(cn => (tt.classTimetables[cn]?.[d]?.[p]?.subject === task.subject))
                        );

                    outer_l:
                    for (const d of PRIORITY_DAYS_B) {
                        if (dayAlreadyHasBlock(d, task.classes)) continue;
                        if (subjectOnDay(d)) continue; // Prefer days with nothing for this subject

                        for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                            if (slotFree(d, fp1, task.classes) && slotFree(d, fp2, task.classes)) {
                                best = { d, p1: fp1, p2: fp2 };
                                break outer_l;
                            }
                        }
                    }

                    // Fallback: relax the subject-on-day constraint, but keep the no-two-blocks constraint
                    if (!best) {
                        outer_l_fallback:
                        for (const d of PRIORITY_DAYS_B) {
                            if (dayAlreadyHasBlock(d, task.classes)) continue;
                            for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                                if (slotFree(d, fp1, task.classes, task.labGroup, task.subject) && slotFree(d, fp2, task.classes, task.labGroup, task.subject)) {
                                    best = { d, p1: fp1, p2: fp2 };
                                    break outer_l_fallback;
                                }
                            }
                        }
                    }

                    // Fallback 2: absolute last resort — relax both constraints
                    if (!best) {
                        outer_l_final:
                        for (const d of PRIORITY_DAYS_B) {
                            for (const [fp1, fp2] of ALL_BLOCK_PAIRS) {
                                if (slotFree(d, fp1, task.classes, task.labGroup, task.subject) && slotFree(d, fp2, task.classes, task.labGroup, task.subject)) {
                                    best = { d, p1: fp1, p2: fp2 };
                                    break outer_l_final;
                                }
                            }
                        }
                    }

                    if (!best) {
                        addMessage(`✗ No free slot for Lab Block ${bi + 1}!`);
                        setCreationStatus(prev => ({ ...prev, isError: true }));
                        return;
                    }

                    // Commit Lab Block
                    const abbr = getAbbreviation(task.subject);
                    const labStatusData = { className: task.classes[0], subject: task.subject, labGroup: task.labGroup, targetLabCount: task.targetLabCount };
                    const isLab1 = determineLabStatus(tt.classTimetables, labStatusData, best.d, best.p1);
                    const isLab2 = determineLabStatus(tt.classTimetables, labStatusData, best.d, best.p2);

                    task.classes.forEach(cn => {
                        tt.classTimetables[cn][best.d][best.p1] = { subject: abbr, teacher, fullSubject: task.subject, isBlock: true, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab1 };
                        tt.classTimetables[cn][best.d][best.p2] = { subject: abbr, teacher, fullSubject: task.subject, isBlock: true, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab2 };
                    });
                    tt.teacherTimetables[teacher][best.d][best.p1] = { className: task.classes.join('/'), subject: task.subject, fullSubject: task.subject, isBlock: true, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab1 };
                    tt.teacherTimetables[teacher][best.d][best.p2] = { className: task.classes.join('/'), subject: task.subject, fullSubject: task.subject, isBlock: true, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab2 };
                    tt.teacherTimetables[teacher][best.d].periodCount += 2;
                    tt.teacherTimetables[teacher].weeklyPeriods += 2;

                    placements.push({ day: best.d, period: `${best.p1}-${best.p2}`, type: 'LBLOCK' });
                    addMessage(`✅ Lab Block placed: ${SHORT[best.d]} P${best.p1.replace('S', '')}-P${best.p2.replace('S', '')}`);
                    placedCount++;
                    await sleep(150);
                }
            }

            // ════════════════════════════════════════════════════════════════════
            // PHASE 2 — SINGLE PERIODS
            // ════════════════════════════════════════════════════════════════════
            if (singleTasks.length > 0) {
                addMessage(`\n🔍 Phase 2: Placing ${singleTasks.length} single period(s)...`);
                await sleep(200);

                const PRIORITY_DAYS = ['Monday', 'Wednesday', 'Friday', 'Tuesday', 'Thursday'];
                const PRIORITY_PRDS = AVAILABLE_SLOTS;
                const TOTAL_PRIORITY_SLOTS = PRIORITY_DAYS.length * PRIORITY_PRDS.length;

                const orderedSlots = [];
                for (let oi = 0; oi < TOTAL_PRIORITY_SLOTS; oi++)
                    orderedSlots.push({
                        d: PRIORITY_DAYS[oi % PRIORITY_DAYS.length],
                        p: PRIORITY_PRDS[oi % PRIORITY_PRDS.length]
                    });

                let existingSingles = 0;
                for (const tName of Object.keys(tt.teacherTimetables)) {
                    for (const d of DAYS) {
                        if (!tt.teacherTimetables[tName]?.[d]) continue;
                        for (const p of PRDS) {
                            const sl = tt.teacherTimetables[tName][d][p];
                            if (sl && typeof sl === 'object' && sl.className && !sl.isBlock) existingSingles++;
                        }
                    }
                }
                let currentSlotIdx = existingSingles % TOTAL_PRIORITY_SLOTS;

                for (let i = 0; i < singleTasks.length; i++) {
                    const task = singleTasks[i];
                    const taskDays = (task.preferredDay && task.preferredDay !== 'Any')
                        ? PRIORITY_DAYS.filter(d => d === (DMAP[task.preferredDay] || task.preferredDay))
                        : PRIORITY_DAYS;

                    let pick = null;

                    // Logic for subject on day:
                    // If subject already has 2+ periods on this day, skip it
                    const subjectCountOnDay = (d) =>
                        PRDS.reduce((count, p) =>
                            count + (task.classes.some(cn => (tt.classTimetables[cn]?.[d]?.[p]?.subject === task.subject)) ? 1 : 0)
                            , 0);

                    // Strategy: diagonal walk, but try to find a day with 0 periods of this subject first
                    for (let attempt = 0; attempt < 100; attempt++) {
                        const slotIdx = (currentSlotIdx + attempt) % orderedSlots.length;
                        const { d, p } = orderedSlots[slotIdx];
                        if (taskDays.length > 0 && !taskDays.includes(d)) continue;
                        if (subjectCountOnDay(d) >= 1) continue; // First pass: prefer fresh days
                        if (slotFree(d, p, task.classes, task.labGroup)) {
                            pick = { d, p, slotIdx };
                            break;
                        }
                    }

                    // Fallback: allow 1 period already existing (total 2 on day)
                    if (!pick) {
                        for (let attempt = 0; attempt < 100; attempt++) {
                            const slotIdx = (currentSlotIdx + attempt) % orderedSlots.length;
                            const { d, p } = orderedSlots[slotIdx];
                            if (taskDays.length > 0 && !taskDays.includes(d)) continue;
                            if (subjectCountOnDay(d) >= 2) continue;
                            if (slotFree(d, p, task.classes, task.labGroup)) {
                                pick = { d, p, slotIdx };
                                break;
                            }
                        }
                    }

                    // Absolute fallback: any free slot
                    if (!pick) {
                        for (let attempt = 0; attempt < 100; attempt++) {
                            const slotIdx = (currentSlotIdx + attempt) % orderedSlots.length;
                            const { d, p } = orderedSlots[slotIdx];
                            if (slotFree(d, p, task.classes, task.labGroup)) {
                                pick = { d, p, slotIdx };
                                break;
                            }
                        }
                    }

                    if (!pick) {
                        addMessage(`✗ No free slot for single period ${i + 1}!`);
                        setCreationStatus(prev => ({ ...prev, isError: true }));
                        return;
                    }

                    const abbr = getAbbreviation(task.subject);
                    const labStatusData = { className: task.classes[0], subject: task.subject, labGroup: task.labGroup, targetLabCount: task.targetLabCount };
                    const isLab = determineLabStatus(tt.classTimetables, labStatusData, pick.d, pick.p);

                    task.classes.forEach(cn => {
                        tt.classTimetables[cn][pick.d][pick.p] = { subject: abbr, teacher, fullSubject: task.subject, isBlock: false, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab };
                    });
                    tt.teacherTimetables[teacher][pick.d][pick.p] = { className: task.classes.join('/'), subject: task.subject, fullSubject: task.subject, isBlock: false, labGroup: task.labGroup, targetLabCount: task.targetLabCount, isLabPeriod: isLab };
                    tt.teacherTimetables[teacher][pick.d].periodCount += 1;
                    tt.teacherTimetables[teacher].weeklyPeriods += 1;

                    placements.push({ day: pick.d, period: pick.p, type: 'SINGLE' });
                    currentSlotIdx = (pick.slotIdx + 1) % orderedSlots.length;
                    placedCount++;
                    await sleep(80);
                }

                addMessage(`\n✅ All ${singleTasks.length} single(s) placed successfully!`);
            }

            // ── Final summary & commit ───────────────────────────────────────────
            if (placedCount === tasks.length) {
                const uniqueDays = new Set(placements.map(p => p.day)).size;
                const uniquePeriods = new Set(placements.map(p => p.period)).size;
                addMessage(`\n📈 Distribution: ${placedCount} period(s) across ${uniqueDays} day(s), ${uniquePeriods} slot(s)`);
                addMessage(`✅ All ${placedCount} periods placed! Format TT updated.`);
                addMessage(`═══════════════════════════════════════`);
                console.log('✅ [CREATE] setGeneratedTimetable called. classTimetables keys:', Object.keys(tt.classTimetables).slice(0, 5));
                await sleep(300);
                const finalTT = syncLabTimetables(tt);
                setGeneratedTimetable(finalTT);
                setCompletedCreations(prev => new Set([...prev, row.id]));
                if (!isBatch) {
                    setTimeout(() => setCreationStatus(null), 5000);
                }
                return tt;
            } else {
                setCreationStatus(prev => ({ ...prev, isError: true }));
                addMessage(`❌ Only placed ${placedCount}/${tasks.length}. Check DPT for conflicts.`);
                return null;
            }

        } catch (err) {
            console.error(err);
            addMessage(`❌ BUILD ERROR: ${err.message}`);
            setCreationStatus(prev => ({ ...prev, isError: true }));
            return null;
        }
    };

    const handleBatchGenerate = async (label, criteria) => {
        const rowsToProcess = allotmentRows.filter(row => {
            if (!row.teacher) return false;
            // Must have non-zero periods to be worth generating
            const totalPeriods = (row.allotments || []).reduce((sum, g) => sum + (Number(g.periods) || 0), 0);
            if (totalPeriods === 0) return false;

            if (completedCreations.has(row.id)) return false;

            const allClasses = row.allotments.flatMap(a => a.classes);
            if (criteria === 'FULL') return true;
            if (criteria === 'MID') return allClasses.some(c => /^[678]/.test(c));
            if (criteria === 'MAIN') return allClasses.some(c => /^(9|10|11|12)/.test(c));
            return allClasses.some(c => c.startsWith(criteria));
        });

        const streamsToProcess = subjectStreams.filter(st => {
            if (completedCreations.has(st.id)) return false;
            if (criteria === 'FULL') return true;
            if (criteria === 'MID') return /^[678]/.test(st.className);
            if (criteria === 'MAIN') return /^(9|10|11|12)/.test(st.className);
            return st.className.startsWith(criteria);
        });

        const totalToProcess = rowsToProcess.length + streamsToProcess.length;

        if (totalToProcess === 0) {
            addToast(`No pending items with allotments found for ${label}`, 'info');
            return;
        }

        const confirmText = criteria === 'FULL'
            ? '🚀 GENERATE ENTIRE TIMETABLE?\nThis will process ALL non-created allotments and streams.'
            : `🚀 Generate ${rowsToProcess.length} teachers and ${streamsToProcess.length} streams for ${label}?`;

        if (!confirm(confirmText)) return;

        addToast(`Starting batch generation for ${label}...`, 'info');

        let currentTT = generatedTimetable;
        let skippedRows = [];
        let generatedCount = 0;

        // Process streams first (they are harder to place)
        for (let i = 0; i < streamsToProcess.length; i++) {
            const stream = streamsToProcess[i];

            setCreationStatus(prev => ({
                ...(prev || { messages: [], teacher: 'Batch', subject: label }),
                batchProgress: `Processing stream ${i + 1} of ${totalToProcess}...`
            }));

            const result = await handleCreateStreamSpecific(stream, currentTT);
            if (result) {
                currentTT = result;
                generatedCount++;
            } else {
                addToast(`Batch stopped at stream ${stream.name} due to an error.`, 'error');
                break;
            }
        }

        if (currentTT) {
            for (let i = 0; i < rowsToProcess.length; i++) {
                const row = rowsToProcess[i];
                const streamOffset = streamsToProcess.length;

                setCreationStatus(prev => ({
                    ...(prev || { messages: [], teacher: 'Batch', subject: label }),
                    batchProgress: `Teacher ${i + streamOffset + 1} of ${totalToProcess}: ${row.teacher}`
                }));

                const result = await handleCreateSpecific(row, currentTT, true);
                if (result) {
                    currentTT = result;
                    generatedCount++;
                } else {
                    addToast(`Batch stopped at ${row.teacher} due to an error.`, 'error');
                    break;
                }
            }
        }

        // Final summary on ribbon
        setCreationStatus(prev => ({
            ...prev,
            teacher: 'COMPLETED',
            subject: label,
            batchProgress: `Batch Finished: ${generatedCount}/${totalToProcess} created.`
        }));
        setTimeout(() => setCreationStatus(null), 10000);

        const skippedCount = skippedRows.length;
        addToast(`✅ Batch generation completed!\n\nGenerated: ${generatedCount}\nSkipped: ${skippedCount}`, 'success');

        if (skippedCount > 0) {
            setTimeout(() => {
                addToast(`⚠️ Skipped (${skippedCount}): ${skippedRows.join(', ')}`, 'warning');
            }, 1000);
        }
    };


    const handleGenerateTimetable = async () => {
        console.log('🔵 ===== GENERATING FROM ALLOTMENT ROWS =====');

        if (!allotmentRows || allotmentRows.length === 0) {
            addToast('⚠️ No allotments found. Please add data in Classes Alloted tab.', 'warning');
            return;
        }

        setIsGenerating(true);

        try {
            // Validation for Subject Streams
            for (const stream of subjectStreams) {
                if (!stream.subjects || stream.subjects.length < 2) {
                    addToast(`⚠️ Stream '${stream.name}' should have at least 2 groups.`, 'warning');
                }
                const incomplete = stream.subjects.some(s => !s.subject || !s.teacher);
                if (incomplete) {
                    setIsGenerating(false);
                    addToast(`❌ Stream '${stream.name}' has incomplete groups (missing subject/teacher).`, 'error');
                    return;
                }
            }

            // Convert new allotmentRows format to legacy format for the generator
            const legacyMappings = [];
            const legacyDistribution = { __merged: {}, __blocks: {}, __days: {} };

            allotmentRows.forEach(row => {
                if (!row.teacher) return;

                // Group allotments by subject for this teacher to create mappings
                const subjectsHandled = new Set();
                (row.allotments || []).forEach(a => { if (a.subject) subjectsHandled.add(a.subject); });

                subjectsHandled.forEach(sub => {
                    const selectedClasses = [];
                    const subAllotments = (row.allotments || []).filter(a => a.subject === sub);

                    subAllotments.forEach(group => {
                        const groupPeriods = Number(group.periods) || 0;
                        if (groupPeriods === 0) return;

                        group.classes.forEach(cls => {
                            selectedClasses.push(cls);
                            if (!legacyDistribution[cls]) legacyDistribution[cls] = {};
                            legacyDistribution[cls][sub] = groupPeriods;

                            if (!legacyDistribution.__labGroups) legacyDistribution.__labGroups = {};
                            if (!legacyDistribution.__labGroups[cls]) legacyDistribution.__labGroups[cls] = {};
                            legacyDistribution.__labGroups[cls][sub] = { labGroup: group.labGroup || 'None', targetLabCount: Number(group.lBlock) || 0 };

                            if (!legacyDistribution.__blocks[cls]) legacyDistribution.__blocks[cls] = {};
                            legacyDistribution.__blocks[cls][sub] = Math.floor((Number(group.tBlock) || 0) / 2) + Math.floor((Number(group.lBlock) || 0) / 2);

                            if (!legacyDistribution.__days[cls]) legacyDistribution.__days[cls] = {};
                            legacyDistribution.__days[cls][sub] = group.preferredDay || 'Any';
                        });

                        if (group.isMerged) {
                            if (!legacyDistribution.__merged[sub]) {
                                legacyDistribution.__merged[sub] = [];
                            }
                            legacyDistribution.__merged[sub].push({
                                classes: group.classes,
                                total: groupPeriods,
                                blockPeriods: Number(group.blockPeriods) || 0,
                                preferredDay: group.preferredDay || 'Any',
                                subject: sub
                            });
                        }
                    });

                    const uniqueClasses = [...new Set(selectedClasses)];
                    if (uniqueClasses.length > 0) {
                        legacyMappings.push({
                            teacher: (row.teacher || '').trim(),
                            subject: sub,
                            selectedClasses: uniqueClasses
                        });
                    }
                });
            });

            console.log('Generated Legacy Data:', {
                mappingsCount: legacyMappings.length,
                mergedCount: Object.keys(legacyDistribution.__merged).length
            });

            const timetable = generateTimetable(
                legacyMappings,
                legacyDistribution,
                bellTimings,
                subjectStreams
            );

            console.log('Generation result:', timetable);
            const finalTT = syncLabTimetables(timetable);
            setGeneratedTimetable(finalTT);
            localStorage.setItem('tt_generated_timetable', JSON.stringify(finalTT));
            if (!baselineTimetable) {
                setBaselineTimetable(timetable);
                localStorage.setItem('tt_baseline_timetable', JSON.stringify(timetable));
            }

            addToast(`✅ Timetable generated!
            
            ${Object.keys(timetable.classTimetables).length} Classes scheduled
            ${Object.keys(timetable.teacherTimetables).length} Teachers scheduled
            ${timetable.errors?.length || 0} warnings`, 'success');

        } catch (error) {
            console.error('❌ ERROR IN GENERATION:', error);
            addToast(`❌ Failed: ${error.message}`, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const tabs = [
        { id: 0, label: '🏫 Teachers & Subjects' },
        { id: 1, label: '👥 Classes Alloted' },
        { id: 2, label: '📊 Distribution' },
        { id: 3, label: '🕒 DPT' },
        { id: 4, label: '🎓 Format TT' },
        { id: 5, label: '👩‍🏫 TeacherTT' },
        { id: 6, label: '⚙️ Generate' }
    ];

    return (
        <div style={{
            minHeight: '100vh',
            background: '#0f172a',
            color: '#f1f5f9',
            padding: '2rem',
            maxWidth: '100%',
            margin: '0 auto',
            fontFamily: 'Inter, sans-serif'
        }}>
            {/* Toast notifications */}
            {toasts.map(t => (
                <div key={t.id} style={{
                    position: 'fixed',
                    top: '1rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: t.type === 'error' ? '#dc2626' : t.type === 'warning' ? '#fbbf24' : '#10b981',
                    color: 'white',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    marginBottom: '0.5rem',
                    whiteSpace: 'pre-wrap'
                }}>
                    {t.msg}
                </div>
            ))}

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', maxWidth: '1440px', margin: '0 auto 2rem auto' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: '900', margin: 0, letterSpacing: '-0.025em' }}>Timetable Studio</h1>
                    <p style={{ color: '#94a3b8' }}>Configuration & AI Generation</p>
                </div>
                <button
                    onClick={() => navigate('/')}
                    style={{
                        padding: '0.7rem 1.4rem',
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '0.8rem',
                        color: 'white',
                        cursor: 'pointer',
                        fontWeight: '700',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.target.style.background = '#334155'}
                    onMouseOut={(e) => e.target.style.background = '#1e293b'}
                >
                    Back to Dashboard
                </button>
            </div>

            {/* Tabs Container (Sticky) */}
            <div style={{
                position: 'sticky',
                top: '0',
                zIndex: 1000,
                maxWidth: '1440px',
                margin: '0 auto',
                display: 'flex',
                gap: '0.6rem',
                background: 'rgba(15, 23, 42, 0.9)', // Semitransparent dark
                backdropFilter: 'blur(10px)',
                padding: '0.8rem',
                borderRadius: '0 0 1rem 1rem',
                marginBottom: '2rem',
                border: '1px solid #334155',
                borderTop: 'none',
                boxShadow: '0 15px 30px -5px rgba(0, 0, 0, 0.6)'
            }}>
                {tabs.map((tab, idx) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '1rem 0.5rem',
                            border: 'none',
                            borderRadius: '0.7rem',
                            background: activeTab === tab.id ? '#4f46e5' : TAB_GRADIENTS[idx],
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: activeTab === tab.id ? '0 10px 15px -3px rgba(79, 70, 229, 0.4)' : 'none',
                            transform: activeTab === tab.id ? 'translateY(-2px)' : 'none',
                            opacity: activeTab === tab.id ? 1 : 0.85
                        }}
                        onMouseOver={(e) => {
                            if (activeTab !== tab.id) e.target.style.opacity = '1';
                        }}
                        onMouseOut={(e) => {
                            if (activeTab !== tab.id) e.target.style.opacity = '0.85';
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div style={{
                maxWidth: '1440px',
                margin: '0 auto',
                background: '#1e293b',
                borderRadius: '1.5rem',
                padding: '2.5rem',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
                border: '1px solid #334155'
            }}>

                {/* Tab 0: Teachers & Subjects with mapping table (selection-only) */}
                {activeTab === 0 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>


                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                            <button
                                disabled={isSaving}
                                onClick={async () => {
                                    const allTeachers = Array.from(new Set(mappingRows.map(r => r.teacher).filter(Boolean))).sort();
                                    const consolidatedMappings = allTeachers.map(t => {
                                        const rows = mappingRows.filter(r => r.teacher === t);
                                        const subjectsList = Array.from(new Set(rows.flatMap(r => r.subjects || (r.subject ? [r.subject] : [])))).sort();
                                        return {
                                            id: rows[0].id,
                                            teacher: t,
                                            subjects: subjectsList,
                                            level: rows[0].level || 'Main'
                                        };
                                    });
                                    const allSubjects = Array.from(new Set(consolidatedMappings.flatMap(m => m.subjects))).sort();

                                    if (allTeachers.length > 0) setTeachers(allTeachers);
                                    if (allSubjects.length > 0) setSubjects(allSubjects);
                                    setMappingRows(consolidatedMappings);
                                    await saveDptData(consolidatedMappings, allTeachers, allSubjects);

                                    const teacherAllotmentsMap = new Map();
                                    allotmentRows.forEach(row => {
                                        if (!row.teacher) return;
                                        if (!teacherAllotmentsMap.has(row.teacher)) teacherAllotmentsMap.set(row.teacher, []);
                                        const updatedGroups = (row.allotments || []).map(g => ({
                                            ...g,
                                            subject: g.subject || row.subject || ''
                                        }));
                                        teacherAllotmentsMap.get(row.teacher).push(...updatedGroups);
                                    });

                                    const mergedRows = allTeachers.map(t => {
                                        const existingGroups = teacherAllotmentsMap.get(t) || [];
                                        const tMapping = consolidatedMappings.find(m => m.teacher === t);
                                        const defaultSub = tMapping?.subjects?.[0] || '';
                                        if (existingGroups.length === 0) {
                                            return {
                                                id: t,
                                                teacher: t,
                                                allotments: [{ id: Date.now() + Math.random(), subject: defaultSub, classes: ['6A'], periods: 0, tBlock: 0, lBlock: 0, preferredDay: 'Any', isMerged: false }],
                                                total: 0
                                            };
                                        }
                                        const validGroups = existingGroups.map(g => ({
                                            ...g,
                                            subject: (tMapping?.subjects?.includes(g.subject) ? g.subject : defaultSub)
                                        }));
                                        return {
                                            id: t,
                                            teacher: t,
                                            allotments: validGroups,
                                            total: validGroups.reduce((sum, g) => sum + (Number(g.periods) || 0), 0)
                                        };
                                    }).sort((a, b) => a.teacher.localeCompare(b.teacher));

                                    setAllotmentRows(mergedRows);
                                    await saveAllotments(mergedRows);
                                    setActiveTab(1);
                                }}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: isSaving ? '#64748b' : 'linear-gradient(135deg, #10b981, #059669)',
                                    color: 'white', border: 'none', borderRadius: '0.75rem', cursor: 'pointer', fontWeight: 'bold'
                                }}
                            >
                                {isSaving ? '⏳ Saving...' : '💾 Save & Next Tab'}
                            </button>
                            <button
                                onClick={() => loadDptData()}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
                                    color: 'white', border: 'none', borderRadius: '0.75rem', cursor: 'pointer', fontWeight: 'bold'
                                }}
                            >
                                ☁️ Reload Cloud
                            </button>
                            <label style={{
                                padding: '0.75rem 1.5rem', background: '#334155', color: 'white', borderRadius: '0.75rem', cursor: 'pointer', fontWeight: 'bold'
                            }}>
                                📤 Upload CSV
                                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleUpload} />
                            </label>
                        </div>

                        <div style={{ overflowX: 'auto', marginBottom: '2rem', borderRadius: '1rem', border: '1px solid #334155', background: '#0f172a' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#1e293b' }}>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8' }}>Teacher Name</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', color: '#94a3b8' }}>Subjects Handled</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', width: '120px' }}>Level</th>
                                        <th style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', width: '100px' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mappingRows.map((row, idx) => (
                                        <tr key={row.id} style={{ borderBottom: '1px solid #334155' }}>
                                            <td style={{ padding: '1rem' }}>
                                                {addingTeacherRowId === row.id ? (
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <input
                                                            autoFocus
                                                            value={newTeacherValue}
                                                            onChange={e => setNewTeacherValue(e.target.value)}
                                                            placeholder="Enter name..."
                                                            style={{ padding: '0.5rem', background: '#1e293b', color: '#fff', border: '1px solid #10b981', borderRadius: '0.5rem', flex: 1 }}
                                                        />
                                                        <button onClick={() => {
                                                            if (newTeacherValue.trim()) {
                                                                setTeachers(p => Array.from(new Set([...p, newTeacherValue.trim()])).sort());
                                                                const r = [...mappingRows]; r[idx].teacher = newTeacherValue.trim();
                                                                setMappingRows(r); setNewTeacherValue(''); setAddingTeacherRowId(null);
                                                            }
                                                        }} style={{ padding: '0.5rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem' }}>✓</button>
                                                    </div>
                                                ) : (
                                                    <select
                                                        value={row.teacher}
                                                        onChange={e => e.target.value === '_type_new' ? setAddingTeacherRowId(row.id) : (() => { const r = [...mappingRows]; r[idx].teacher = e.target.value; setMappingRows(r) })()}
                                                        style={{ width: '100%', padding: '0.7rem', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '0.5rem' }}
                                                    >
                                                        <option value="">-- Select Teacher --</option>
                                                        {teachers.map(t => <option key={t} value={t} style={{ color: '#000', background: '#fff' }}>{t}</option>)}
                                                        <option value="_type_new" style={{ color: '#000', background: '#fff' }}>✏️ New Teacher...</option>
                                                    </select>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                                    {(row.subjects || []).map(s => (
                                                        <div key={s} style={{ background: '#4f46e5', color: '#fff', padding: '0.3rem 0.6rem', borderRadius: '0.4rem', fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                                                            {s} <span onClick={() => { const r = [...mappingRows]; r[idx].subjects = r[idx].subjects.filter(x => x !== s); setMappingRows(r); }} style={{ cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                                        </div>
                                                    ))}
                                                    <select
                                                        value=""
                                                        onChange={e => {
                                                            if (e.target.value === '_type_new') setAddingSubjectRowId(row.id);
                                                            else if (e.target.value) {
                                                                const r = [...mappingRows]; if (!r[idx].subjects) r[idx].subjects = [];
                                                                if (!r[idx].subjects.includes(e.target.value)) r[idx].subjects.push(e.target.value);
                                                                setMappingRows(r);
                                                            }
                                                        }}
                                                        style={{ padding: '0.4rem', background: 'transparent', color: '#94a3b8', border: '1px dashed #475569', borderRadius: '0.4rem', fontSize: '0.8rem' }}
                                                    >
                                                        <option value="">+ Add Subject</option>
                                                        {subjects.filter(s => !(row.subjects || []).includes(s)).map(s => <option key={s} value={s} style={{ color: '#000', background: '#fff' }}>{s}</option>)}
                                                        <option value="_type_new" style={{ color: '#000', background: '#fff' }}>✏️ New...</option>
                                                    </select>
                                                </div>
                                                {addingSubjectRowId === row.id && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                        <input autoFocus value={newSubjectValue} onChange={e => setNewSubjectValue(e.target.value)} style={{ padding: '0.4rem', background: '#1e293b', color: '#fff', border: '1px solid #10b981', borderRadius: '0.4rem', flex: 1 }} />
                                                        <button onClick={() => {
                                                            if (newSubjectValue.trim()) {
                                                                setSubjects(p => Array.from(new Set([...p, newSubjectValue.trim()])).sort());
                                                                const r = [...mappingRows]; if (!r[idx].subjects) r[idx].subjects = [];
                                                                r[idx].subjects.push(newSubjectValue.trim()); setMappingRows(r);
                                                                setNewSubjectValue(''); setAddingSubjectRowId(null);
                                                            }
                                                        }} style={{ padding: '0.4rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.4rem' }}>✓</button>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <select
                                                    value={row.level}
                                                    onChange={e => { const r = [...mappingRows]; r[idx].level = e.target.value; setMappingRows(r); }}
                                                    style={{ width: '100%', padding: '0.7rem', background: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '0.5rem' }}
                                                >
                                                    {['Main', 'Middle', 'Senior', 'Middle&Main', 'Main&Senior', 'Middle&Senior', 'Middle,Main&Senior'].map(l => <option key={l} value={l} style={{ color: '#000', background: '#fff' }}>{l.replace(/&/g, ' & ')}</option>)}
                                                </select>
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <button onClick={() => setMappingRows(mappingRows.filter((_, i) => i !== idx))} style={{ padding: '0.5rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>Delete</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button
                            onClick={() => setMappingRows([...mappingRows, { id: Date.now() + Math.random(), teacher: '', subjects: [], level: 'Main' }])}
                            style={{ padding: '0.8rem 1.5rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            + Add New Teacher
                        </button>
                        <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#1e293b', borderRadius: '1rem', border: '1px solid #334155' }}>
                            <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1rem' }}>SUMMARY STATISTICS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1.5rem' }}>
                                <div><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>TEACHERS</div><div style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 800 }}>{teachers.length}</div></div>
                                <div><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>SUBJECTS</div><div style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 800 }}>{subjects.length}</div></div>
                                <div><div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>MAPPINGS</div><div style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 800 }}>{mappingRows.length}</div></div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 1 && (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>

                        {/* Status ribbon is now a fixed bottom ribbon — see below */}
                        <h2 style={{ color: '#f1f5f9', marginBottom: '1rem' }}>Classes Alloted</h2>

                        {/* Parallel Subject Streams Section */}
                        <div style={{
                            marginBottom: '2rem',
                            padding: '1.5rem',
                            background: 'linear-gradient(145deg, #1e293b, #0f172a)',
                            borderRadius: '1.2rem',
                            border: '1px solid #334155',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ padding: '0.6rem', background: 'rgba(129, 140, 248, 0.1)', borderRadius: '0.75rem' }}>
                                        <span style={{ fontSize: '1.5rem' }}>🔗</span>
                                    </div>
                                    <div>
                                        <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 800 }}>Parallel Subject Streams</h3>
                                        <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>Multiple teachers teaching different groups of the same class</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        setEditingStreamId(null);
                                        setStreamForm({ name: '', className: '6A', periods: 4, subjects: [{ teacher: '', subject: '', groupName: '' }] });
                                        setShowStreamModal(true);
                                    }}
                                    style={{
                                        padding: '0.6rem 1.2rem',
                                        background: '#4f46e5',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: '700',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={e => e.currentTarget.style.background = '#6366f1'}
                                    onMouseOut={e => e.currentTarget.style.background = '#4f46e5'}
                                >
                                    ＋ Add New Parallel Stream
                                </button>
                            </div>

                            {subjectStreams.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', border: '2px dashed #334155', borderRadius: '0.75rem' }}>
                                    No parallel streams defined yet. Use streams for subjects like "2nd Language" or "Electives".
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                                    {subjectStreams.map(stream => (
                                        <div key={stream.id} style={{
                                            background: '#1e293b',
                                            borderRadius: '0.8rem',
                                            padding: '1rem',
                                            border: '1px solid #475569',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.75rem'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <div style={{ fontWeight: 900, color: '#f1f5f9' }}>{stream.name}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#818cf8', fontWeight: 700 }}>{stream.className} • {stream.periods} Periods/Week</div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                    <button
                                                        onClick={() => handleCreateStreamSpecific(stream)}
                                                        disabled={completedCreations.has(stream.id)}
                                                        style={{
                                                            padding: '0.3rem 0.6rem',
                                                            background: completedCreations.has(stream.id) ? '#10b981' : '#3b82f6',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '0.4rem',
                                                            fontSize: '0.7rem',
                                                            fontWeight: 'bold',
                                                            cursor: completedCreations.has(stream.id) ? 'not-allowed' : 'pointer'
                                                        }}
                                                    >
                                                        {completedCreations.has(stream.id) ? '✅ CREATED' : 'CREATE'}
                                                    </button>
                                                    <button onClick={() => handleEditStream(stream)} style={{ padding: '0.3rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Edit">✏️</button>
                                                    <button onClick={() => handleDeleteStream(stream.id)} style={{ padding: '0.3rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Delete">🗑️</button>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                {stream.subjects.map((s, idx) => (
                                                    <div key={idx} style={{
                                                        padding: '0.25rem 0.5rem',
                                                        background: 'rgba(79, 70, 229, 0.15)',
                                                        border: '1px solid rgba(129, 140, 248, 0.3)',
                                                        borderRadius: '0.4rem',
                                                        fontSize: '0.7rem'
                                                    }}>
                                                        <span style={{ color: '#fff', fontWeight: 700 }}>{s.subject}</span>
                                                        <span style={{ color: '#94a3b8', margin: '0 0.3rem' }}>-</span>
                                                        <span style={{ color: '#c084fc', fontWeight: 600 }}>{s.teacher}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                            <button
                                onClick={() => saveAllotments()}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: isSaving ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    opacity: isSaving ? 0.7 : 1
                                }}
                                disabled={isSaving}
                            >
                                💾 {isSaving ? 'Saving...' : 'Save Data'}
                            </button>
                            <button
                                onClick={loadAllotments}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#334155',
                                    color: 'white',
                                    border: '1px solid #475569',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >
                                ☁️ Load Cloud
                            </button>
                            <button
                                onClick={clearAllotments}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: 'transparent',
                                    color: '#f87171',
                                    border: '1px solid #450a0a',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
                                }}
                            >
                                🧹 Clear Saved
                            </button>

                        </div>

                        {/* Batch Generation Control Row */}
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.4rem',
                            marginBottom: '1.5rem',
                            background: '#1e293b',
                            padding: '0.8rem',
                            borderRadius: '1rem',
                            border: '1px solid #334155',
                            alignItems: 'center'
                        }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#64748b', marginRight: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>⚡ Batch Gen:</span>
                            {['6', '7', '8', '9', '10', '11', '12'].map(g => (
                                <button key={g} onClick={() => handleBatchGenerate(`Grade ${g}`, g)} style={{ padding: '0.4rem 0.8rem', background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = '#475569'} onMouseOut={e => e.currentTarget.style.background = '#334155'}>
                                    Gen{g}
                                </button>
                            ))}
                            <div style={{ width: '1px', height: '1.2rem', background: '#334155', margin: '0 0.4rem' }} />
                            <button onClick={() => handleBatchGenerate('Middle School', 'MID')} style={{ padding: '0.4rem 0.8rem', background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                GenMid
                            </button>
                            <button onClick={() => handleBatchGenerate('Main School', 'MAIN')} style={{ padding: '0.4rem 0.8rem', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>
                                GenMain
                            </button>
                            <button onClick={() => handleBatchGenerate('Full School', 'FULL')} style={{ padding: '0.4rem 1.2rem', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 900, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.3)' }}>
                                🚀 GenFull
                            </button>

                            <div style={{ width: '1px', height: '1.2rem', background: '#334155', margin: '0 0.8rem' }} />

                            <button
                                onClick={() => setAllotmentFilterPriority(!allotmentFilterPriority)}
                                style={{
                                    padding: '0.4rem 1rem',
                                    background: allotmentFilterPriority ? '#7c3aed' : '#334155',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.5rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem'
                                }}
                            >
                                🎯 {allotmentFilterPriority ? 'Sorted by Priority' : 'Sort by Priority'}
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                color: '#f1f5f9'
                            }}>
                                <thead>
                                    <tr style={{ background: '#1e293b' }}>
                                        <th style={{
                                            padding: '0.75rem',
                                            textAlign: 'left',
                                            width: '240px',
                                            position: 'sticky',
                                            left: 0,
                                            background: '#1e293b',
                                            zIndex: 20,
                                            boxShadow: '4px 0 4px rgba(0,0,0,0.3)',
                                            borderRight: '1px solid #334155'
                                        }}>Teacher Name</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left', width: '180px' }}>Subject</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Class Allotments</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'center', width: '90px' }}>Total</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'center', width: '150px' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        let rows = [...allotmentRows];
                                        if (allotmentFilterPriority) {
                                            const getRowPriority = (row) => {
                                                let highest = 4;
                                                (row.allotments || []).forEach(a => {
                                                    let p = 4;
                                                    if (a.preferredDay && a.preferredDay !== 'Any') p = 1;
                                                    else if (Number(a.tBlock) > 0 || Number(a.lBlock) > 0) p = 2;
                                                    if (p < highest) highest = p;
                                                });
                                                return highest;
                                            };
                                            const getRowMaxGrade = (row) => {
                                                let max = 0;
                                                (row.allotments || []).forEach(a => {
                                                    const g = parseInt(a.classes?.[0]) || 0;
                                                    if (g > max) max = g;
                                                });
                                                return max;
                                            };
                                            rows.sort((a, b) => {
                                                const pa = getRowPriority(a);
                                                const pb = getRowPriority(b);
                                                if (pa !== pb) return pa - pb;
                                                // Tie-break with grade level descending
                                                const ga = getRowMaxGrade(a);
                                                const gb = getRowMaxGrade(b);
                                                if (ga !== gb) return gb - ga;
                                                return a.teacher.localeCompare(b.teacher);
                                            });
                                        }
                                        return rows.map(row => {
                                            const streamPeriods = (subjectStreams || []).reduce((acc, st) => {
                                                if (st.subjects.some(s => s.teacher === row.teacher)) return acc + (Number(st.periods) || 0);
                                                return acc;
                                            }, 0);
                                            const grandTotal = (row.total || 0) + streamPeriods;

                                            return (
                                                <tr key={row.id} style={{
                                                    borderBottom: '1px solid #334155',
                                                    transition: 'background 0.2s'
                                                }}>
                                                    <td
                                                        style={{
                                                            padding: '0.8rem',
                                                            color: '#f1f5f9',
                                                            fontWeight: '700',
                                                            textAlign: 'left',
                                                            position: 'sticky',
                                                            left: 0,
                                                            background: '#1e293b',
                                                            zIndex: 10,
                                                            boxShadow: '4px 0 4px rgba(0,0,0,0.3)',
                                                            borderRight: '1px solid #334155',
                                                            userSelect: 'none'
                                                        }}>
                                                        <span style={{ color: '#f1f5f9' }}>{row.teacher || '(No Teacher)'}</span>
                                                    </td>
                                                    <td style={{ padding: '0.8rem', minWidth: '150px' }}>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                                            {(mappingRows.find(m => (m.teacher || '').trim() === (row.teacher || '').trim())?.subjects || []).map(s => (
                                                                <span key={s} style={{
                                                                    fontSize: '0.7rem',
                                                                    background: '#334155',
                                                                    padding: '0.1rem 0.4rem',
                                                                    borderRadius: '0.3rem',
                                                                    color: '#94a3b8',
                                                                    fontWeight: '800',
                                                                    border: '1px solid #475569'
                                                                }}>
                                                                    {s}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.6rem' }}>
                                                        <div style={{
                                                            display: 'flex',
                                                            gap: '0.6rem',
                                                            flexWrap: 'wrap',
                                                            alignItems: 'center',
                                                            maxWidth: '1000px'
                                                        }}>
                                                            {(row.allotments || []).map((group, gIdx) => {
                                                                const isSelected = selectedGroups.some(s => s.rowId === row.id && s.groupIndex === gIdx);
                                                                const isGrpExpanded = expandedGroup?.rowId === row.id && expandedGroup?.groupIndex === gIdx;
                                                                const grade = group.classes[0]?.match(/\d+/)?.[0];

                                                                return (
                                                                    <div
                                                                        key={group.id}
                                                                        className="group-expansion-container"
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            background: 'transparent',
                                                                            borderRadius: '0.6rem',
                                                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                        }}
                                                                    >
                                                                        {/* Group boxes rendering as before but without row expansion check */}
                                                                        <div
                                                                            onClick={(e) => {
                                                                                if (e.ctrlKey) {
                                                                                    const exists = selectedGroups.some(s => s.rowId === row.id && s.groupIndex === gIdx);
                                                                                    if (exists) setSelectedGroups(prev => prev.filter(s => !(s.rowId === row.id && s.groupIndex === gIdx)));
                                                                                    else {
                                                                                        if (selectedGroups.length > 0) {
                                                                                            const first = allotmentRows.find(r => r.id === selectedGroups[0].rowId);
                                                                                            const firstGroup = first?.allotments[selectedGroups[0].groupIndex];
                                                                                            const firstGrade = firstGroup?.classes[0]?.match(/\d+/)?.[0];
                                                                                            if (selectedGroups[0].rowId !== row.id || firstGrade !== grade) {
                                                                                                setSelectedGroups([{ rowId: row.id, groupIndex: gIdx }]);
                                                                                            } else {
                                                                                                setSelectedGroups(prev => [...prev, { rowId: row.id, groupIndex: gIdx }]);
                                                                                            }
                                                                                        } else {
                                                                                            setSelectedGroups([{ rowId: row.id, groupIndex: gIdx }]);
                                                                                        }
                                                                                    }
                                                                                } else {
                                                                                    setExpandedGroup(isGrpExpanded ? null : { rowId: row.id, groupIndex: gIdx });
                                                                                }
                                                                            }}
                                                                            onContextMenu={(e) => {
                                                                                if (group.isMerged) {
                                                                                    e.preventDefault();
                                                                                    if (confirm(`Unmerge classes ${group.classes.join(', ')}?`)) {
                                                                                        unmergeGroup(row.id, gIdx);
                                                                                    }
                                                                                }
                                                                            }}
                                                                            style={{
                                                                                padding: '0.4rem 0.8rem',
                                                                                background: isSelected ? '#fbbf24' : (group.isMerged ? 'linear-gradient(135deg, #4f46e5, #4338ca)' : '#1e293b'),
                                                                                color: isSelected ? '#000' : '#fff',
                                                                                borderRadius: '0.5rem',
                                                                                fontSize: '0.85rem',
                                                                                fontWeight: '900',
                                                                                cursor: 'pointer',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '0.6rem',
                                                                                border: isGrpExpanded ? '2px solid #38bdf8' : '1px solid #334155',
                                                                                boxShadow: isGrpExpanded ? '0 0 12px rgba(56, 189, 248, 0.25)' : '0 1px 2px rgba(0,0,0,0.2)',
                                                                                zIndex: 2,
                                                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                                height: '34px',
                                                                                boxSizing: 'border-box'
                                                                            }}
                                                                        >
                                                                            {(() => {
                                                                                let p = 4;
                                                                                if (group.preferredDay && group.preferredDay !== 'Any') p = 1;
                                                                                else if (Number(group.tBlock) > 0 || Number(group.lBlock) > 0) p = 2;

                                                                                if (p === 4) return null;
                                                                                return (
                                                                                    <span style={{
                                                                                        fontSize: '0.65rem',
                                                                                        background: p === 1 ? '#ef4444' : '#f59e0b',
                                                                                        color: 'white',
                                                                                        padding: '0.1rem 0.3rem',
                                                                                        borderRadius: '0.3rem',
                                                                                        fontWeight: 900,
                                                                                        marginRight: '-0.2rem'
                                                                                    }}>P{p}</span>
                                                                                );
                                                                            })()}
                                                                            {group.isMerged && <span title="Merged Group" style={{ fontSize: '0.8rem' }}>🔗</span>}

                                                                            {(!group.isMerged && isGrpExpanded) ? (
                                                                                <select
                                                                                    value={group.classes[0]}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'class', e.target.value)}
                                                                                    style={{
                                                                                        background: 'transparent',
                                                                                        border: 'none',
                                                                                        color: '#fff',
                                                                                        fontWeight: '900',
                                                                                        fontSize: '0.85rem',
                                                                                        cursor: 'pointer',
                                                                                        outline: 'none',
                                                                                        padding: 0
                                                                                    }}
                                                                                >
                                                                                    {CLASS_OPTIONS.map(c => <option key={c} value={c} style={{ color: '#000', background: '#fff' }}>{c}</option>)}
                                                                                </select>
                                                                            ) : (
                                                                                <span style={{ letterSpacing: '0.02em' }}>{formatClasses(group.classes)}</span>
                                                                            )}

                                                                            <span style={{
                                                                                fontSize: '0.7rem',
                                                                                opacity: 0.6,
                                                                                transform: isGrpExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                                                                display: 'inline-block',
                                                                                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                                color: '#94a3b8'
                                                                            }}>{isGrpExpanded ? '▼' : '▶'}</span>
                                                                        </div>

                                                                        <div style={{
                                                                            display: 'flex',
                                                                            overflow: 'hidden',
                                                                            maxWidth: isGrpExpanded ? '700px' : '0px',
                                                                            opacity: isGrpExpanded ? 1 : 0,
                                                                            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                            background: '#cbd5e1',
                                                                            color: '#1e293b',
                                                                            borderRadius: '0.5rem',
                                                                            marginLeft: isGrpExpanded ? '0.6rem' : '0px',
                                                                            whiteSpace: 'nowrap',
                                                                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                                                            border: isGrpExpanded ? '1px solid #94a3b8' : 'none',
                                                                            alignItems: 'center',
                                                                            height: '34px',
                                                                            boxSizing: 'border-box'
                                                                        }}>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #94a3b8', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8' }}>SUB</span>
                                                                                <select
                                                                                    value={group.subject || ''}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'subject', e.target.value)}
                                                                                    style={{
                                                                                        background: 'transparent',
                                                                                        border: 'none',
                                                                                        color: '#111827',
                                                                                        fontWeight: '800',
                                                                                        fontSize: '0.8rem',
                                                                                        cursor: 'pointer',
                                                                                        outline: 'none',
                                                                                        padding: 0
                                                                                    }}
                                                                                >
                                                                                    <option value="">-- sub --</option>
                                                                                    {(mappingRows.find(m => (m.teacher || '').trim() === (row.teacher || '').trim())?.subjects || []).map(s => (
                                                                                        <option key={s} value={s}>{s}</option>
                                                                                    ))}
                                                                                </select>
                                                                            </div>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #94a3b8', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8' }}>LAB</span>
                                                                                <select
                                                                                    value={group.labGroup || 'None'}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'labGroup', e.target.value)}
                                                                                    style={{ background: 'transparent', border: 'none', color: '#1e293b', fontWeight: 900, fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}
                                                                                >
                                                                                    <option value="None">None</option>
                                                                                    <option value="CSc Lab Group">CSc Group</option>
                                                                                    <option value="DS/AI Lab Group">DS/AI Group</option>
                                                                                </select>
                                                                            </div>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #94a3b8', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8' }}>PPS</span>
                                                                                <select
                                                                                    value={group.periods || 0}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'periods', e.target.value)}
                                                                                    style={{ background: 'transparent', border: 'none', color: '#1e293b', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', outline: 'none' }}
                                                                                >
                                                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #94a3b8', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#f59e0b' }}>TB</span>
                                                                                <select
                                                                                    value={group.tBlock || 0}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'tBlock', e.target.value)}
                                                                                    style={{ background: 'transparent', border: 'none', color: '#1e293b', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', outline: 'none' }}
                                                                                >
                                                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #94a3b8', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#10b981' }}>LB</span>
                                                                                <select
                                                                                    value={group.lBlock || 0}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'lBlock', e.target.value)}
                                                                                    style={{ background: 'transparent', border: 'none', color: '#1e293b', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', outline: 'none' }}
                                                                                >
                                                                                    {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div style={{ padding: '0 0.8rem', borderRight: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                                                                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#3b82f6' }}>DAY</span>
                                                                                <select
                                                                                    value={group.preferredDay || 'Any'}
                                                                                    onChange={e => updateAllotmentGroup(row.id, gIdx, 'preferredDay', e.target.value)}
                                                                                    style={{ background: 'transparent', border: 'none', color: '#1e293b', fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', outline: 'none' }}
                                                                                >
                                                                                    {['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => <option key={d} value={d}>{d}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div
                                                                                onClick={(e) => { e.stopPropagation(); deleteAllotmentGroup(row.id, gIdx); }}
                                                                                style={{
                                                                                    padding: '0 1rem',
                                                                                    color: '#ef4444',
                                                                                    cursor: 'pointer',
                                                                                    fontWeight: 'bold',
                                                                                    height: '100%',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    transition: 'background 0.2s'
                                                                                }}
                                                                                onMouseOver={e => e.currentTarget.style.background = '#fef2f2'}
                                                                                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                                                                title="Delete Allotment"
                                                                            >✕</div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) {
                                                                        const rect = e.target.getBoundingClientRect();
                                                                        const firstGroup = row.allotments[selectedGroups[0].groupIndex];
                                                                        const g = firstGroup.classes[0].match(/\d+/)?.[0];
                                                                        setMergePopup({
                                                                            rowId: row.id,
                                                                            groupIndices: selectedGroups.map(s => s.groupIndex),
                                                                            grade: g,
                                                                            rect
                                                                        });
                                                                    } else {
                                                                        addAllotmentGroup(row.id);
                                                                    }
                                                                }}
                                                                style={{
                                                                    padding: '0.4rem 1rem',
                                                                    background: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#fbbf24' : '#1e293b',
                                                                    color: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '#000' : '#818cf8',
                                                                    border: (selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? 'none' : '1px dashed #4f46e5',
                                                                    borderRadius: '0.5rem',
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '800',
                                                                    transition: 'all 0.2s',
                                                                    whiteSpace: 'nowrap',
                                                                    height: '34px',
                                                                    boxSizing: 'border-box',
                                                                    marginLeft: '0.2rem'
                                                                }}
                                                            >
                                                                {(selectedGroups.length > 1 && selectedGroups[0].rowId === row.id) ? '🔗 Merge Selected' : '＋ Add Group'}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.6rem', textAlign: 'center', fontWeight: 'bold' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                            <span style={{ color: '#fff' }}>{grandTotal}</span>
                                                            {streamPeriods > 0 && (
                                                                <span style={{ fontSize: '0.65rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '1px 4px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                                                    incl. {streamPeriods} [S]
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.6rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                            <button
                                                                onClick={() => handleCreateSpecific(row)}
                                                                disabled={creationStatus || completedCreations.has(row.id)}
                                                                style={{
                                                                    padding: '0.5rem 1rem',
                                                                    background: completedCreations.has(row.id) ? '#10b981' : (creationStatus ? '#475569' : '#3b82f6'),
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '0.5rem',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: '800',
                                                                    cursor: (creationStatus || completedCreations.has(row.id)) ? 'not-allowed' : 'pointer',
                                                                    transition: 'all 0.2s',
                                                                    boxShadow: completedCreations.has(row.id) ? '0 0 10px rgba(16,185,129,0.3)' : 'none'
                                                                }}
                                                            >
                                                                {completedCreations.has(row.id) ? '✅' : 'CREATE'}
                                                            </button>
                                                            <button
                                                                onClick={() => handleSmartReassign(row)}
                                                                title="Smart Reassign"
                                                                style={{
                                                                    padding: '0.5rem 0.8rem',
                                                                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '0.5rem',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: '800',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >🪄</button>
                                                            <button
                                                                onClick={() => handleDeleteClick(row)}
                                                                title="Delete Periods"
                                                                style={{
                                                                    padding: '0.5rem 0.8rem',
                                                                    background: '#450a0a',
                                                                    color: '#f87171',
                                                                    border: '1px solid #7f1d1d',
                                                                    borderRadius: '0.5rem',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: '800',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >🗑️</button>
                                                            <button
                                                                onClick={() => { if (confirm('Delete this whole row?')) deleteAllotmentRow(row.id); }}
                                                                title="Delete Row"
                                                                style={{
                                                                    padding: '0.5rem 0.8rem',
                                                                    background: '#7f1d1d',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '0.5rem',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: '800',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >✕</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {/* Merge Popup */}
                        {
                            mergePopup && (
                                <div style={{
                                    position: 'fixed',
                                    top: 0, left: 0, right: 0, bottom: 0,
                                    background: 'rgba(0,0,0,0.7)',
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    zIndex: 3000,
                                    backdropFilter: 'blur(4px)',
                                    animation: 'fadeIn 0.2s ease-out'
                                }}>
                                    <div style={{
                                        background: '#1e293b',
                                        padding: '2rem',
                                        borderRadius: '1.25rem',
                                        border: '1px solid #4f46e5',
                                        width: '350px',
                                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                                        position: 'relative'
                                    }}>
                                        <h3 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.4rem' }}>🔗 Merge Classes</h3>
                                        <p style={{ fontSize: '0.95rem', color: '#94a3b8', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                                            Combining <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{mergePopup.groupIndices.length}</span> allocations for <span style={{ color: '#fff' }}>Grade {mergePopup.grade}</span>.
                                        </p>

                                        <div style={{ marginBottom: '2rem', background: '#0f172a', padding: '1rem', borderRadius: '0.8rem', border: '1px solid #334155' }}>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: '#818cf8', fontWeight: 'bold', marginBottom: '0.6rem', textTransform: 'uppercase' }}>Weekly Periods</label>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8rem' }}>
                                                <input
                                                    autoFocus
                                                    type="number"
                                                    defaultValue="5"
                                                    id="merge_periods_input"
                                                    style={{
                                                        fontSize: '1.5rem',
                                                        fontWeight: 'bold',
                                                        width: '80px',
                                                        padding: '0.5rem',
                                                        background: 'transparent',
                                                        color: '#fbbf24',
                                                        border: 'none',
                                                        borderBottom: '2px solid #4f46e5',
                                                        outline: 'none',
                                                        textAlign: 'center'
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            handleMergeConfirm(e.target.value);
                                                        }
                                                    }}
                                                />
                                                <span style={{ color: '#475569', fontSize: '0.9rem' }}>periods shared per week</span>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'flex-end' }}>
                                            <button
                                                onClick={() => setMergePopup(null)}
                                                style={{
                                                    padding: '0.7rem 1.2rem',
                                                    background: 'transparent',
                                                    border: '1px solid #475569',
                                                    borderRadius: '0.6rem',
                                                    color: '#94a3b8',
                                                    cursor: 'pointer',
                                                    fontWeight: '600'
                                                }}
                                            >Cancel</button>
                                            <button
                                                onClick={() => {
                                                    const val = document.getElementById('merge_periods_input').value;
                                                    handleMergeConfirm(val);
                                                }}
                                                style={{
                                                    padding: '0.7rem 1.5rem',
                                                    background: '#4f46e5',
                                                    border: 'none',
                                                    borderRadius: '0.6rem',
                                                    color: '#fff',
                                                    cursor: 'pointer',
                                                    fontWeight: '700',
                                                    boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.4)'
                                                }}
                                            >Confirm Merge</button>
                                        </div>
                                    </div>
                                </div>
                            )
                        }

                        {/* ── DELETE TIMETABLE POPUP ── */}
                        {
                            reassignWizard && (() => {
                                const { step, row, newTeacher, analysis } = reassignWizard;
                                const teachersList = [...new Set(allotmentRows.map(r => r.teacher))].filter(Boolean).filter(t => t !== row.teacher);

                                return (
                                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
                                        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '1.5rem', width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                                            {/* Header */}
                                            <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to right, #1e293b, #0f172a)' }}>
                                                <div>
                                                    <h3 style={{ margin: 0, color: 'white', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                        <span style={{ fontSize: '1.5rem' }}>🪄</span> Smart Teacher Reassignment
                                                    </h3>
                                                    <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
                                                        Moving {row.subject} from <b>{row.teacher}</b> to another teacher
                                                    </p>
                                                </div>
                                                <button onClick={() => setReassignWizard(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', transition: 'color 0.2s' }} onMouseOver={e => e.target.style.color = 'white'} onMouseOut={e => e.target.style.color = '#94a3b8'}>&times;</button>
                                            </div>

                                            {/* Steps Indicator */}
                                            <div style={{ display: 'flex', padding: '1rem 2rem', background: '#0f172a', gap: '1rem', borderBottom: '1px solid #334155' }}>
                                                {[1, 2, 3].map(s => (
                                                    <div key={s} style={{ flex: 1, height: '4px', background: s <= step ? '#f59e0b' : '#334155', borderRadius: '2px', transition: 'background 0.3s' }} />
                                                ))}
                                            </div>

                                            <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
                                                {step === 1 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                        <div style={{ background: '#0f172a', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #334155' }}>
                                                            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.8rem', fontWeight: 600 }}>1. SELECT TARGET TEACHER</label>
                                                            <select
                                                                value={newTeacher || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    const impact = analyzeReassignmentImpact(row, val);
                                                                    setReassignWizard(prev => ({ ...prev, newTeacher: val, analysis: impact }));
                                                                }}
                                                                style={{ width: '100%', padding: '1rem', background: '#1e293b', border: '2px solid #334155', borderRadius: '0.8rem', color: 'white', fontSize: '1rem', cursor: 'pointer' }}
                                                            >
                                                                <option value="">-- Choose Target Teacher --</option>
                                                                {teachersList.sort().map(t => <option key={t} value={t}>{t}</option>)}
                                                            </select>
                                                        </div>

                                                        {analysis && (
                                                            <div style={{ animation: 'fadeInScale 0.3s ease-out' }}>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                                                    <div style={{ padding: '1rem', background: '#1e293b', borderRadius: '0.8rem', border: '1px solid #334155', textAlign: 'center' }}>
                                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>Affects Slots</div>
                                                                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#f59e0b' }}>{analysis.assignments.length}</div>
                                                                    </div>
                                                                    <div style={{ padding: '1rem', background: '#1e293b', borderRadius: '0.8rem', border: '1px solid #334155', textAlign: 'center' }}>
                                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>Direct Clashes</div>
                                                                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: analysis.clashes.length > 0 ? '#ef4444' : '#10b981' }}>{analysis.clashes.length}</div>
                                                                    </div>
                                                                    <div style={{ padding: '1rem', background: '#1e293b', borderRadius: '0.8rem', border: '1px solid #334155', textAlign: 'center' }}>
                                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>Total Weekly</div>
                                                                        <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'white' }}>{analysis.currentWorkload + analysis.assignments.length}</div>
                                                                    </div>
                                                                </div>

                                                                {/* Daily Workload Indicator */}
                                                                <div style={{ background: '#0f172a', padding: '1.2rem', borderRadius: '1rem', border: '1px solid #334155', marginBottom: '1.5rem' }}>
                                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.8rem', letterSpacing: '0.05em' }}>Daily Period Distribution (Max 6)</div>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
                                                                        {Object.entries(analysis.dailyWorkload).map(([day, stats]) => (
                                                                            <div key={day} style={{ textAlign: 'center', padding: '0.5rem', borderRadius: '0.6rem', background: stats.total > 6 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(30, 41, 59, 0.5)', border: `1px solid ${stats.total > 6 ? '#ef4444' : '#334155'}` }}>
                                                                                <div style={{ fontSize: '0.65rem', color: stats.total > 6 ? '#f87171' : '#94a3b8', fontWeight: 700 }}>{day.substring(0, 3)}</div>
                                                                                <div style={{ fontSize: '1.1rem', fontWeight: 900, color: stats.total > 6 ? '#ef4444' : (stats.extra > 0 ? '#3b82f6' : 'white') }}>
                                                                                    {stats.total}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {analysis.clashes.length > 0 ? (
                                                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1.2rem', borderRadius: '0.8rem' }}>
                                                                        <h4 style={{ margin: '0 0 0.8rem 0', color: '#ef4444', fontSize: '0.95rem' }}>⚠️ Availability Conflicts Detected</h4>
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                                            {analysis.clashes.map((c, ci) => (
                                                                                <span key={ci} style={{ fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.2)', padding: '0.3rem 0.6rem', borderRadius: '0.4rem', color: '#fecaca' }}>
                                                                                    {c.day} {c.period} ({c.className})
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ) : analysis.overloadedDays.length > 0 ? (
                                                                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1.2rem', borderRadius: '0.8rem' }}>
                                                                        <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444', fontSize: '0.95rem' }}>🚨 Workload Limit Exceeded</h4>
                                                                        <p style={{ margin: 0, color: '#fca5a5', fontSize: '0.85rem' }}>
                                                                            Cannot reassign - {newTeacher} would exceed 6 periods on: <b>{analysis.overloadedDays.join(', ')}</b>.
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.2rem', borderRadius: '0.8rem' }}>
                                                                        <h4 style={{ margin: 0, color: '#10b981', fontSize: '0.95rem' }}>✅ Target teacher is fully available and within workload limits!</h4>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {step === 2 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                        <label style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>2. CHOOSE REASSIGNMENT STRATEGY</label>

                                                        {/* Option A: Full Swap */}
                                                        <button
                                                            onClick={() => setReassignWizard(prev => ({ ...prev, step: 3, strategy: 'DIRECT' }))}
                                                            disabled={analysis.clashes.length > 0}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.5rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '1rem', color: 'white', textAlign: 'left', cursor: analysis.clashes.length > 0 ? 'not-allowed' : 'pointer', transition: 'all 0.2s', opacity: analysis.clashes.length > 0 ? 0.5 : 1 }}
                                                            onMouseOver={e => !analysis.clashes.length && (e.currentTarget.style.borderColor = '#10b981')}
                                                            onMouseOut={e => e.currentTarget.style.borderColor = '#334155'}
                                                        >
                                                            <div style={{ fontSize: '2rem' }}>🔄</div>
                                                            <div>
                                                                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#10b981' }}>Option A: Full Swap</div>
                                                                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Complete replacement. All classes move from <b>{row.teacher}</b> to <b>{newTeacher}</b>.</div>
                                                            </div>
                                                        </button>

                                                        {/* Option B: Partial Swap */}
                                                        <button
                                                            onClick={() => setReassignWizard(prev => ({ ...prev, step: 3, strategy: 'SELECTIVE', selectedGroups: new Set() }))}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.5rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '1rem', color: 'white', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s' }}
                                                            onMouseOver={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                                                            onMouseOut={e => (e.currentTarget.style.borderColor = '#334155')}
                                                        >
                                                            <div style={{ fontSize: '2rem' }}>✂️</div>
                                                            <div>
                                                                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#3b82f6' }}>Option B: Partial Swap</div>
                                                                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Selective transfer. Choose specific classes/divisions to move.</div>
                                                            </div>
                                                        </button>

                                                        {/* Option C: AI Re-gen */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                            <button
                                                                onClick={() => setReassignWizard(prev => ({ ...prev, step: 3, strategy: 'PARTIAL' }))}
                                                                style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1.5rem', background: '#0f172a', border: '1px solid #4f46e5', borderRadius: '1rem', color: 'white', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s' }}
                                                                onMouseOver={e => (e.currentTarget.style.boxShadow = '0 0 15px rgba(79, 70, 229, 0.3)')}
                                                                onMouseOut={e => (e.currentTarget.style.boxShadow = 'none')}
                                                            >
                                                                <div style={{ fontSize: '2rem' }}>🪄</div>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#818cf8' }}>Option C: Smart AI Re-reg</div>
                                                                        <span style={{ fontSize: '0.7rem', background: '#4f46e5', padding: '0.2rem 0.5rem', borderRadius: '1rem' }}>RECOMMENDED</span>
                                                                    </div>
                                                                    <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>AI resolves conflicts by regenerating affected slots only.</div>
                                                                </div>
                                                            </button>

                                                            {reassignWizard.strategy === 'PARTIAL' && (
                                                                <div style={{ marginLeft: '4.5rem', display: 'flex', gap: '1rem', animation: 'slideDown 0.2s ease-out' }}>
                                                                    <label style={{ color: '#94a3b8', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                                        <input type="radio" name="scope" checked={reassignWizard.scope === 'MINIMAL'} onChange={() => setReassignWizard(prev => ({ ...prev, scope: 'MINIMAL' }))} /> Minimal (Swapped only)
                                                                    </label>
                                                                    <label style={{ color: '#94a3b8', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                                        <input type="radio" name="scope" checked={reassignWizard.scope === 'GRADE'} onChange={() => setReassignWizard(prev => ({ ...prev, scope: 'GRADE' }))} /> Grade-level (Full grade)
                                                                    </label>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Option D: Full Regeneration */}
                                                        <button
                                                            onClick={() => setReassignWizard(prev => ({ ...prev, step: 3, strategy: 'FULL' }))}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1rem 1.5rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '1rem', color: 'white', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', opacity: 0.8 }}
                                                            onMouseOver={e => (e.currentTarget.style.borderColor = '#ef4444')}
                                                            onMouseOut={e => e.currentTarget.style.borderColor = '#334155'}
                                                        >
                                                            <div style={{ fontSize: '1.5rem' }}>🔄</div>
                                                            <div>
                                                                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#ef4444' }}>Option D: Full Re-generation</div>
                                                                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Rebuild entire timetable from scratch. Guaranteed conflict-free.</div>
                                                            </div>
                                                        </button>
                                                    </div>
                                                )}

                                                {step === 3 && reassignWizard.strategy === 'SELECTIVE' && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                        <div>
                                                            <label style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 600 }}>3. SELECT CLASSES TO TRANSFER</label>
                                                            <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.4rem 0 1.25rem 0' }}>From <b>{row.teacher}</b> to <b>{newTeacher}</b></p>
                                                        </div>

                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', background: '#0f172a', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #334155' }}>
                                                            {analysis.groupedAssignments.map(g => (
                                                                <label key={g.className} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: '#1e293b', borderRadius: '0.8rem', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#334155'} onMouseOut={e => e.currentTarget.style.background = '#1e293b'}>
                                                                    <input
                                                                        type="checkbox"
                                                                        style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                                                                        checked={reassignWizard.selectedGroups.has(g.className)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(reassignWizard.selectedGroups);
                                                                            if (e.target.checked) newSet.add(g.className);
                                                                            else newSet.delete(g.className);
                                                                            setReassignWizard(prev => ({ ...prev, selectedGroups: newSet }));
                                                                        }}
                                                                    />
                                                                    <div style={{ flex: 1 }}>
                                                                        <div style={{ fontWeight: 800, color: 'white' }}>{g.className} {row.subject}</div>
                                                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{g.summary} <span style={{ color: '#f59e0b', fontWeight: 700, marginLeft: '0.5rem' }}>({g.count} periods)</span></div>
                                                                    </div>
                                                                </label>
                                                            ))}
                                                        </div>

                                                        <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '1.2rem', borderRadius: '0.8rem' }}>
                                                            <div style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                                                                Selected: <b>{Array.from(reassignWizard.selectedGroups).reduce((sum, cls) => sum + (analysis.groupedAssignments.find(g => g.className === cls)?.count || 0), 0)} periods</b> will transfer.
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.4rem' }}>
                                                                Remaining with {row.teacher}: <b>{analysis.assignments.length - Array.from(reassignWizard.selectedGroups).reduce((sum, cls) => sum + (analysis.groupedAssignments.find(g => g.className === cls)?.count || 0), 0)} periods</b>.
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {step === 3 && reassignWizard.strategy !== 'SELECTIVE' && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                        <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '1.5rem', borderRadius: '1rem', textAlign: 'center' }}>
                                                            <h4 style={{ margin: '0 0 0.5rem 0', color: '#f59e0b', fontSize: '1.1rem' }}>Ready to Apply Changes</h4>
                                                            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
                                                                Strategy: <b style={{ color: 'white' }}>{reassignWizard.strategy === 'DIRECT' ? 'Option A: Full Swap' : (reassignWizard.strategy === 'SELECTIVE' ? 'Option B: Partial Swap' : (reassignWizard.strategy === 'PARTIAL' ? 'Option C: Smart AI Re-reg' : 'Full Re-reg'))}</b>
                                                            </p>
                                                        </div>

                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.9rem' }}>
                                                                <span>New Teacher:</span>
                                                                <b style={{ color: 'white' }}>{newTeacher}</b>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.9rem' }}>
                                                                <span>Affected Classes:</span>
                                                                <b style={{ color: 'white' }}>{[...new Set(analysis.assignments.map(a => a.className))].join(', ')}</b>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.9rem' }}>
                                                                <span>Total Modifications:</span>
                                                                <b style={{ color: '#f59e0b' }}>{analysis.assignments.length} slots</b>
                                                            </div>
                                                        </div>

                                                        <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '0.8rem', border: '1px solid #334155' }}>
                                                            <h5 style={{ margin: '0 0 0.5rem 0', color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase' }}>Preview of First 3 Changes</h5>
                                                            {analysis.assignments.slice(0, 3).map((a, ai) => (
                                                                <div key={ai} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#cbd5e1' }}>
                                                                    <span style={{ color: '#f59e0b' }}>•</span> {a.day} {a.period} in {a.className}: {row.teacher} ➔ <b>{newTeacher}</b>
                                                                </div>
                                                            ))}
                                                            {analysis.assignments.length > 3 && <div style={{ fontSize: '0.8rem', color: '#475569', textAlign: 'center', marginTop: '0.5rem' }}>+ {analysis.assignments.length - 3} more changes</div>}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Footer */}
                                            <div style={{ padding: '1.25rem 2rem', borderTop: '1px solid #334155', background: '#0f172a', display: 'flex', justifyContent: 'space-between' }}>
                                                <button
                                                    onClick={() => step > 1 ? setReassignWizard(prev => ({ ...prev, step: prev.step - 1 })) : setReassignWizard(null)}
                                                    style={{ padding: '0.8rem 1.5rem', background: 'transparent', border: '1px solid #334155', borderRadius: '0.8rem', color: '#94a3b8', cursor: 'pointer', fontWeight: 700 }}
                                                >
                                                    {step === 1 ? 'Cancel' : 'Back'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (step < 3) {
                                                            setReassignWizard(prev => ({ ...prev, step: prev.step + 1 }));
                                                        } else {
                                                            // Execute based on strategy
                                                            executeSmartReassign();
                                                        }
                                                    }}
                                                    disabled={
                                                        (step === 1 && (!newTeacher || (analysis && (analysis.clashes.length > 0 || analysis.overloadedDays.length > 0)))) ||
                                                        (step === 2 && !reassignWizard.strategy) ||
                                                        (step === 3 && reassignWizard.strategy === 'SELECTIVE' && reassignWizard.selectedGroups.size === 0)
                                                    }
                                                    style={{
                                                        padding: '0.8rem 2rem',
                                                        background: ((step === 1 && (!newTeacher || (analysis && (analysis.clashes.length > 0 || analysis.overloadedDays.length > 0)))) || (step === 2 && !reassignWizard.strategy) || (step === 3 && reassignWizard.strategy === 'SELECTIVE' && reassignWizard.selectedGroups.size === 0)) ? '#334155' : 'linear-gradient(135deg, #4f46e5, #4338ca)',
                                                        border: 'none',
                                                        borderRadius: '0.8rem',
                                                        color: 'white',
                                                        cursor: ((step === 1 && (!newTeacher || (analysis && (analysis.clashes.length > 0 || analysis.overloadedDays.length > 0)))) || (step === 2 && !reassignWizard.strategy)) ? 'not-allowed' : 'pointer',
                                                        fontWeight: 800,
                                                        boxShadow: '0 10px 15px -3px rgba(79, 70, 229, 0.4)'
                                                    }}
                                                >
                                                    {step === 3 ? 'Confirm & Apply' : 'Continue Analysis'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()
                        }

                        {
                            deletePopup && (() => {
                                const { row, classGroups, checked, expanded } = deletePopup;
                                const selCount = (cn) => checked[cn]?.size || 0;
                                const totalSel = classGroups.reduce((s, { className }) => s + selCount(className), 0);

                                const togglePeriod = (cn, key) => setDeletePopup(prev => {
                                    const nxt = { ...prev, checked: { ...prev.checked } };
                                    const set = new Set(nxt.checked[cn]);
                                    if (set.has(key)) set.delete(key); else set.add(key);
                                    nxt.checked[cn] = set;
                                    return nxt;
                                });
                                const toggleClass = (cn, periods) => setDeletePopup(prev => {
                                    const nxt = { ...prev, checked: { ...prev.checked } };
                                    const allKeys = periods.map(p => `${p.day}|${p.periodKey}`);
                                    const allChecked = allKeys.every(k => nxt.checked[cn]?.has(k));
                                    nxt.checked[cn] = allChecked ? new Set() : new Set(allKeys);
                                    return nxt;
                                });
                                const toggleExpand = (cn) => setDeletePopup(prev => {
                                    const exp = new Set(prev.expanded);
                                    if (exp.has(cn)) exp.delete(cn); else exp.add(cn);
                                    return { ...prev, expanded: exp };
                                });
                                const selectAll = () => setDeletePopup(prev => ({
                                    ...prev, checked: Object.fromEntries(
                                        prev.classGroups.map(({ className, periods }) =>
                                            [className, new Set(periods.map(p => `${p.day}|${p.periodKey}`))])
                                    )
                                }));
                                const deselectAll = () => setDeletePopup(prev => ({
                                    ...prev, checked: Object.fromEntries(prev.classGroups.map(({ className }) => [className, new Set()]))
                                }));

                                return (
                                    <div onClick={() => setDeletePopup(null)} style={{
                                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                                        background: 'rgba(0,0,0,0.75)', display: 'flex',
                                        justifyContent: 'center', alignItems: 'center',
                                        zIndex: 4000, backdropFilter: 'blur(5px)',
                                        animation: 'fadeIn 0.2s ease-out'
                                    }}>
                                        <div onClick={e => e.stopPropagation()} style={{
                                            background: '#0f172a', border: '1px solid #dc2626',
                                            borderRadius: '1.25rem', width: '560px', maxWidth: '95vw',
                                            maxHeight: '85vh', display: 'flex', flexDirection: 'column',
                                            boxShadow: '0 25px 50px -12px rgba(220,38,38,0.35)', overflow: 'hidden'
                                        }}>
                                            {/* Header */}
                                            <div style={{ padding: '1.25rem 1.5rem', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
                                                <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#f87171', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Delete Timetable</div>
                                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f1f5f9' }}>{row.teacher}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.1rem' }}>{row.subject}</div>
                                            </div>
                                            {/* Bulk actions bar */}
                                            <div style={{ padding: '0.6rem 1.5rem', background: '#1e293b', borderBottom: '1px solid #0f172a', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                                                <span style={{ fontSize: '0.78rem', color: '#64748b', flexGrow: 1 }}>Select periods to remove:</span>
                                                <button onClick={selectAll} style={{ padding: '0.28rem 0.7rem', background: '#334155', border: 'none', borderRadius: '0.35rem', color: '#cbd5e1', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>Select All</button>
                                                <button onClick={deselectAll} style={{ padding: '0.28rem 0.7rem', background: '#334155', border: 'none', borderRadius: '0.35rem', color: '#cbd5e1', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>Deselect All</button>
                                            </div>
                                            {/* Classes list */}
                                            <div style={{ overflowY: 'auto', flexGrow: 1, padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                {classGroups.map(({ className, periods }) => {
                                                    const allKeys = periods.map(p => `${p.day}|${p.periodKey}`);
                                                    const sel = checked[className];
                                                    const allChecked = allKeys.length > 0 && allKeys.every(k => sel?.has(k));
                                                    const anyChecked = allKeys.some(k => sel?.has(k));
                                                    const isExpanded = expanded.has(className);
                                                    return (
                                                        <div key={className}>
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                                                padding: '0.55rem 0.8rem',
                                                                background: anyChecked ? 'rgba(220,38,38,0.1)' : '#1e293b',
                                                                borderRadius: '0.55rem',
                                                                border: `1px solid ${anyChecked ? 'rgba(220,38,38,0.5)' : '#334155'}`,
                                                                transition: 'all 0.15s'
                                                            }}>
                                                                <input type="checkbox" checked={allChecked}
                                                                    ref={el => { if (el) el.indeterminate = anyChecked && !allChecked; }}
                                                                    onChange={() => toggleClass(className, periods)}
                                                                    style={{ width: 16, height: 16, accentColor: '#dc2626', cursor: 'pointer', flexShrink: 0 }} />
                                                                <span onClick={() => toggleClass(className, periods)}
                                                                    style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.92rem', flexGrow: 1, cursor: 'pointer' }}>{className}</span>
                                                                <span style={{ fontSize: '0.73rem', color: '#64748b' }}>{periods.length} period{periods.length !== 1 ? 's' : ''}</span>
                                                                {anyChecked && !allChecked && (
                                                                    <span style={{ fontSize: '0.68rem', color: '#f87171', background: 'rgba(220,38,38,0.18)', padding: '0.12rem 0.4rem', borderRadius: '0.3rem' }}>{sel.size} sel</span>
                                                                )}
                                                                <button onClick={() => toggleExpand(className)}
                                                                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.15rem', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</button>
                                                            </div>
                                                            {isExpanded && (
                                                                <div style={{ marginLeft: '1.8rem', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                                                                    {periods.map(({ day, periodKey, time }) => {
                                                                        const key = `${day}|${periodKey}`;
                                                                        const isCk = sel?.has(key);
                                                                        return (
                                                                            <label key={key} style={{
                                                                                display: 'flex', alignItems: 'center', gap: '0.45rem',
                                                                                padding: '0.32rem 0.55rem',
                                                                                background: isCk ? 'rgba(220,38,38,0.07)' : 'transparent',
                                                                                borderRadius: '0.35rem', cursor: 'pointer',
                                                                                border: `1px solid ${isCk ? 'rgba(220,38,38,0.25)' : 'transparent'}`,
                                                                                transition: 'all 0.1s'
                                                                            }}>
                                                                                <input type="checkbox" checked={!!isCk} onChange={() => togglePeriod(className, key)}
                                                                                    style={{ width: 13, height: 13, accentColor: '#dc2626', cursor: 'pointer', flexShrink: 0 }} />
                                                                                <span style={{ fontSize: '0.8rem', color: isCk ? '#fca5a5' : '#94a3b8' }}>
                                                                                    <span style={{ fontWeight: 600, color: isCk ? '#f87171' : '#cbd5e1' }}>{DAY_LABELS[day] || day}</span>
                                                                                    {' '}{periodKey} <span style={{ color: '#475569', fontSize: '0.72rem' }}>({time})</span>
                                                                                </span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {/* Footer */}
                                            <div style={{ padding: '0.9rem 1.5rem', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#0f172a' }}>
                                                <span style={{ fontSize: '0.78rem', color: totalSel > 0 ? '#f87171' : '#475569' }}>
                                                    {totalSel > 0 ? `${totalSel} period${totalSel !== 1 ? 's' : ''} selected` : 'Nothing selected'}
                                                </span>
                                                <div style={{ display: 'flex', gap: '0.55rem' }}>
                                                    <button onClick={() => setDeletePopup(null)} style={{ padding: '0.55rem 1.1rem', background: 'transparent', border: '1px solid #334155', borderRadius: '0.55rem', color: '#94a3b8', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>Cancel</button>
                                                    <button onClick={executeDelete} disabled={totalSel === 0} style={{
                                                        padding: '0.55rem 1.25rem',
                                                        background: totalSel === 0 ? '#1e293b' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                                                        border: `1px solid ${totalSel === 0 ? '#334155' : '#dc2626'}`,
                                                        borderRadius: '0.55rem',
                                                        color: totalSel === 0 ? '#475569' : '#fff',
                                                        cursor: totalSel === 0 ? 'not-allowed' : 'pointer',
                                                        fontWeight: 800, fontSize: '0.82rem',
                                                        boxShadow: totalSel > 0 ? '0 4px 12px rgba(220,38,38,0.4)' : 'none',
                                                        transition: 'all 0.2s'
                                                    }}>🗑️ Delete {totalSel > 0 ? `(${totalSel})` : ''}</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()
                        }
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={addAllotmentRow}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#4f46e5',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >+ Add Row</button>
                            <button
                                onClick={() => saveAllotments()}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                            >💾 Save All Changes</button>
                        </div>
                    </div >
                )
                }

                {/* Tab 4: Format TT (moved down) */}
                {
                    activeTab === 4 && (() => {
                        const GRADE_CLASSES = {
                            '6': ['6A', '6B', '6C', '6D', '6E', '6F', '6G'],
                            '7': ['7A', '7B', '7C', '7D', '7E', '7F', '7G'],
                            '8': ['8A', '8B', '8C', '8D', '8E', '8F', '8G'],
                            '9': ['9A', '9B', '9C', '9D', '9E', '9F', '9G'],
                            '10': ['10A', '10B', '10C', '10D', '10E', '10F', '10G'],
                            '11': ['11A', '11B', '11C', '11D', '11E', '11F'],
                            '12': ['12A', '12B', '12C', '12D', '12E', '12F'],
                        };
                        const gradeClassList = GRADE_CLASSES[activeGradeSubTab] || [];
                        const DAYS = [['MON', 'Monday'], ['TUE', 'Tuesday'], ['WED', 'Wednesday'], ['THU', 'Thursday'], ['FRI', 'Friday'], ['SAT', 'Saturday']];

                        return (
                            <div ref={formatTTContainerRef} style={{ animation: 'fadeIn 0.3s ease-out', position: 'relative' }}>
                                {/* SVG Overlay for Chain Arrows */}
                                {chainSwapMode && chainCoords.length >= 2 && (
                                    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100, width: '100%', height: '100%' }}>
                                        <defs>
                                            <marker id="arrowhead-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
                                            </marker>
                                            <marker id="arrowhead-gray" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                                            </marker>
                                        </defs>
                                        {chainCoords.slice(0, -1).map((start, i) => {
                                            const end = chainCoords[i + 1];
                                            const isLastLink = i === chainCoords.length - 2;
                                            const strokeColor = isLastLink ? '#fbbf24' : '#94a3b8';
                                            const dx = end.x - start.x;
                                            const dy = end.y - start.y;
                                            const len = Math.sqrt(dx * dx + dy * dy);
                                            if (len < 10) return null;
                                            const margin = 35;
                                            const x1 = start.x + (dx / len) * margin;
                                            const y1 = start.y + (dy / len) * margin;
                                            const x2 = end.x - (dx / len) * margin;
                                            const y2 = end.y - (dy / len) * margin;
                                            return (
                                                <line
                                                    key={i}
                                                    x1={x1} y1={y1}
                                                    x2={x2} y2={y2}
                                                    stroke={strokeColor}
                                                    strokeWidth="3"
                                                    strokeLinecap="round"
                                                    markerEnd={isLastLink ? "url(#arrowhead-amber)" : "url(#arrowhead-gray)"}
                                                    style={{ filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.5))' }}
                                                />
                                            );
                                        })}
                                    </svg>
                                )}
                                {/* Grade Tabs */}
                                <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.2rem', background: '#1e293b', padding: '0.8rem', borderRadius: '0.8rem', border: '1px solid #334155', flexWrap: 'wrap' }}>
                                    {[6, 7, 8, 9, 10, 11, 12].map(grade => (
                                        <button key={grade}
                                            onClick={() => setActiveGradeSubTab(grade.toString())}
                                            style={{
                                                padding: '0.6rem 1.1rem', border: 'none', borderRadius: '0.6rem', cursor: 'pointer',
                                                background: activeGradeSubTab === grade.toString() ? '#4f46e5' : '#334155',
                                                color: 'white', fontWeight: 700, fontSize: '0.9rem', transition: 'all 0.2s',
                                                boxShadow: activeGradeSubTab === grade.toString() ? '0 4px 12px rgba(79,70,229,0.3)' : 'none',
                                                transform: activeGradeSubTab === grade.toString() ? 'translateY(-2px)' : 'none'
                                            }}
                                        >Grade {grade}</button>
                                    ))}
                                </div>

                                {/* Change Summary Panel */}
                                {timetableChanges.count > 0 && (
                                    <div style={{
                                        marginBottom: '2rem', padding: '1.5rem', background: 'rgba(249, 115, 22, 0.05)',
                                        borderRadius: '1rem', border: '1px solid rgba(249, 115, 22, 0.2)',
                                        display: 'flex', flexDirection: 'column', gap: '1.2rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ background: '#f97316', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', fontWeight: 900, fontSize: '0.9rem' }}>
                                                    {timetableChanges.count} CHANGES DETECTED
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const firstChange = timetableChanges.diffs.find(d => {
                                                            const gradeMatch = cls.startsWith(activeGradeSubTab); // Simplified check
                                                            return true; // Just find the first one in the diffs for now and scroll its ID
                                                        });
                                                        if (firstChange) {
                                                            const el = document.getElementById(`class-card-${firstChange.class}`);
                                                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                        }
                                                    }}
                                                    style={{ background: '#4f46e5', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                                                >Scroll to First Change</button>
                                                <button
                                                    onClick={() => {
                                                        setBaselineTimetable(JSON.parse(JSON.stringify(generatedTimetable)));
                                                        addToast('Baseline reset to current state', 'success');
                                                    }}
                                                    style={{ background: '#334155', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
                                                >Reset Baseline</button>
                                            </div>

                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={showChangesOnly} onChange={e => setShowChangesOnly(e.target.checked)} />
                                                    Show changes only
                                                </label>
                                                <select
                                                    value={highlightTeacher || ''}
                                                    onChange={e => setHighlightTeacher(e.target.value || null)}
                                                    style={{ background: '#0f172a', border: '1px solid #334155', color: 'white', padding: '0.4rem', borderRadius: '0.4rem', fontSize: '0.85rem' }}
                                                >
                                                    <option value="">Filter by Teacher...</option>
                                                    {[...new Set(timetableChanges.diffs.map(d => d.new.teacher))].sort().map(t => (
                                                        <option key={t} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                            <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '0.6rem', border: '1px solid #1e293b' }}>
                                                <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.4rem' }}>Impacted Classes</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                    {Object.entries(timetableChanges.diffs.reduce((acc, d) => { acc[d.class] = (acc[d.class] || 0) + 1; return acc; }, {}))
                                                        .map(([c, count]) => (
                                                            <span key={c} style={{ fontSize: '0.75rem', background: '#1e293b', padding: '0.1rem 0.4rem', borderRadius: '0.3rem', color: '#cbd5e1' }}>
                                                                {c} <b style={{ color: '#f97316' }}>{count}</b>
                                                            </span>
                                                        ))}
                                                </div>
                                            </div>
                                            <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '0.6rem', border: '1px solid #1e293b' }}>
                                                <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.4rem' }}>Affected Teachers</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                    {Object.entries(timetableChanges.diffs.reduce((acc, d) => {
                                                        const t = d.new.teacher || 'Unassigned';
                                                        acc[t] = (acc[t] || 0) + 1;
                                                        return acc;
                                                    }, {}))
                                                        .map(([t, count]) => (
                                                            <span key={t} style={{ fontSize: '0.75rem', background: '#1e293b', padding: '0.1rem 0.4rem', borderRadius: '0.3rem', color: '#cbd5e1' }}>
                                                                {t} <b style={{ color: '#f97316' }}>{count}</b>
                                                            </span>
                                                        ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Baseline Capture Prompt (if none exists) */}
                                {!baselineTimetable && generatedTimetable && (
                                    <div style={{ marginBottom: '2rem', padding: '1rem', background: '#1e293b', borderRadius: '0.8rem', border: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Capture current state as baseline to track future changes?</span>
                                        <button
                                            onClick={() => setBaselineTimetable(JSON.parse(JSON.stringify(generatedTimetable)))}
                                            style={{ background: '#4f46e5', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 700 }}
                                        >Enable Change Tracking</button>
                                    </div>
                                )}

                                {/* Page heading */}
                                <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <h2 style={{ color: '#f1f5f9', fontSize: '1.2rem', fontWeight: 900, margin: 0 }}>
                                        🎓 Grade {activeGradeSubTab} Timetables
                                    </h2>
                                    <span style={{ color: '#475569', fontSize: '0.8rem' }}>({gradeClassList.join(', ')})</span>

                                    {/* Chain Swap Button */}
                                    <button
                                        onClick={() => {
                                            setChainSwapMode(m => !m);
                                            setSwapChain([]);
                                            setIsChainComplete(false);
                                        }}
                                        style={{
                                            marginLeft: 'auto',
                                            padding: '0.5rem 1rem',
                                            background: chainSwapMode ? '#dc2626' : '#4f46e5',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        {chainSwapMode ? '🚫 Cancel Chain' : '🔗 Start Chain'}
                                    </button>
                                    {chainSwapMode && (
                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                            {isChainComplete
                                                ? '✅ CHAIN COMPLETE (LOOP DETECTED)'
                                                : swapChain.length === 0
                                                    ? 'Click a period cell to select Period A'
                                                    : `Chain Length: ${swapChain.length} - Click start cell to close loop`}
                                        </span>
                                    )}
                                </div>

                                {/* All classes stacked vertically */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                                    {gradeClassList.map(cls => {
                                        const renderCell = (dayKey, periodKey) => {
                                            const cell = generatedTimetable?.classTimetables?.[cls]?.[dayKey]?.[periodKey];
                                            if (!cell || !cell.subject) return null;

                                            // Change Tracking Logic
                                            const change = timetableChanges.diffs.find(d => d.class === cls && d.day === dayKey && d.period === periodKey);
                                            const isChanged = !!change;

                                            if (cell.isStream) {
                                                return (
                                                    <div className={`tt-cell-parent ${isChanged ? 'tt-cell-changed' : ''}`} style={{
                                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px',
                                                        height: '100%', width: '100%', minHeight: '40px'
                                                    }}>
                                                        <span style={{ fontWeight: 800, fontSize: '0.85em', color: '#fbbf24', lineHeight: 1.1, textAlign: 'center' }}>{cell.subject}</span>
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
                                                ? (() => { const pts = cell.teacher.trim().split(/\s+/); const fn = pts[0] ? pts[0][0].toUpperCase() + pts[0].slice(1).toLowerCase() : ''; const si = pts[1] ? pts[1][0].toUpperCase() : ''; return si ? `${fn} ${si}` : fn; })()
                                                : '';
                                            return (
                                                <div className={`tt-cell-parent ${isChanged ? 'tt-cell-changed' : ''}`} style={{
                                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
                                                    height: '100%', width: '100%', minHeight: '40px'
                                                }}>
                                                    <span style={{ fontWeight: 700, fontSize: '1em', letterSpacing: '0.02em', lineHeight: 1.1 }}>
                                                        {abbr}{cell.isLabPeriod ? ' [LAB]' : (cell.labGroup && cell.labGroup !== 'None' ? ' [TH]' : '')}{cell.isTBlock ? ' [T]' : (cell.isLBlock ? ' [L]' : '')}
                                                    </span>
                                                    {teacherFirst && <span style={{ fontWeight: 400, fontSize: '0.65em', color: '#94a3b8', lineHeight: 1 }}>{teacherFirst}</span>}

                                                    {isChanged && (
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

                                        // Filter Logic: If "Show changes only" is ON, skip classes that have zero changes in the entire week
                                        if (showChangesOnly) {
                                            const hasAnyChange = timetableChanges.diffs.some(d => d.class === cls);
                                            if (!hasAnyChange) return null;
                                        }

                                        return (
                                            <div key={cls} id={`class-card-${cls}`} style={{ background: '#1e293b', borderRadius: '1rem', padding: '1.5rem 2rem', border: '1px solid #334155' }}>
                                                {/* Class header */}
                                                <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
                                                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.04em' }}>
                                                        THE CHOICE SCHOOL, Tripunithura &nbsp;·&nbsp; {academicYear || '2026-27'}
                                                    </div>
                                                    <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#0ea5e9', marginTop: '0.25rem', letterSpacing: '0.06em' }}>
                                                        {cls}
                                                    </div>
                                                </div>

                                                {/* Timetable grid */}
                                                <div style={{ overflowX: 'auto', width: '100%', maxWidth: 1200, margin: '0 auto' }}>
                                                    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1100px', background: 'transparent', color: '#f1f5f9', fontFamily: 'inherit' }}>
                                                        <thead>
                                                            <tr>
                                                                <th style={ttCellHeader({})}></th>
                                                                {(() => {
                                                                    const isMiddle = ['6', '7', '8'].includes(activeGradeSubTab);
                                                                    const bell = bellTimings[isMiddle ? 'middleSchool' : 'seniorSchool'];
                                                                    const headers = [
                                                                        { label: 'CT', time: '8:00-8:35' },
                                                                        { label: 'P1', time: bell?.S1 || '8:35-9:15' },
                                                                        { label: 'P2', time: bell?.S2 || '9:15-9:55' },
                                                                        { label: 'BRK', time: bell?.S3 || '9:55-10:10' },
                                                                        { label: 'P3', time: bell?.S4 || '10:10-10:50' },
                                                                        { label: 'P4', time: bell?.S5 || '10:50-11:30' },
                                                                        { label: 'P5', time: bell?.S6 || '11:30-12:10' },
                                                                        { label: 'BRK', time: bell?.S7 || '12:10-12:20' },
                                                                        { label: 'P6', time: bell?.S8 || '12:20-13:00' },
                                                                        { label: isMiddle ? 'LUNCH' : 'P7', time: bell?.S9 || '13:00-13:30' },
                                                                        { label: isMiddle ? 'P7' : 'LUNCH', time: bell?.S10 || '13:30-14:05' },
                                                                        { label: 'P8', time: bell?.S11 || '14:05-14:55' }
                                                                    ];
                                                                    return headers.map((h, hi) => (
                                                                        <th key={hi} style={ttCellHeader({
                                                                            background: h.label === 'BRK' ? 'rgba(251,191,36,0.1)' : (h.label === 'LUNCH' ? 'rgba(56,189,248,0.1)' : 'transparent'),
                                                                            color: h.label === 'BRK' ? '#fbbf24' : (h.label === 'LUNCH' ? '#38bdf8' : '#f1f5f9')
                                                                        })}>
                                                                            {h.label}<br /><span style={{ fontWeight: 400, fontSize: '0.8em', color: '#94a3b8' }}>{h.time}</span>
                                                                        </th>
                                                                    ));
                                                                })()}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {DAYS.map((day, i) => (
                                                                <tr key={day[1]}>
                                                                    <th style={ttCellDay()}>{day[0]}</th>
                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'CT') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'CT').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'CT').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'CT').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'CT'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'CT'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'CT')}</td>
                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S1') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S1').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S1').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S1').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S1'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S1'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S1')}</td>
                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S2') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S2').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S2').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S2').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S2'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S2'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S2')}</td>

                                                                    {/* S3: BREAK I merged vertically */}
                                                                    {i === 0 ? (
                                                                        <td rowSpan={DAYS.length} style={ttCellBreak('BREAK', DAYS.length)}>
                                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.2rem', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>BREAK</span>
                                                                        </td>
                                                                    ) : null}

                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S4') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S4').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S4').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S4').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S4'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S4'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S4')}</td>
                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S5') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S5').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S5').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S5').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S5'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S5'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S5')}</td>
                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S6') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S6').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S6').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S6').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S6'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S6'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S6')}</td>

                                                                    {/* S7: BREAK II merged vertically */}
                                                                    {i === 0 ? (
                                                                        <td rowSpan={DAYS.length} style={ttCellBreak('BREAK', DAYS.length)}>
                                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.2rem', color: '#fbbf24', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>BREAK</span>
                                                                        </td>
                                                                    ) : null}

                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S8') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S8').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S8').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S8').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S8'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S8'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S8')}</td>

                                                                    {/* S9 & S10: Dynamic Periodic/Lunch merged vertically */}
                                                                    {(() => {
                                                                        const isMiddle = ['6', '7', '8'].includes(activeGradeSubTab);
                                                                        if (isMiddle) {
                                                                            return (
                                                                                <>
                                                                                    {i === 0 ? (
                                                                                        <td rowSpan={DAYS.length} style={ttCellBreak('LUNCH', DAYS.length)}>
                                                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.2rem', color: '#38bdf8', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>LUNCH</span>
                                                                                        </td>
                                                                                    ) : null}
                                                                                    <td style={ttCell({
                                                                                        background: (() => {
                                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S10') ? idx : -1).filter(i => i !== -1);
                                                                                            if (indices.length === 0) return '#1e293b';
                                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                                        })(),
                                                                                        border: (() => {
                                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                                            const last = swapChain[swapChain.length - 1];
                                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                                            const isDest = getBlockEntries(cls, day[1], 'S10').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                                            // Source check: find the boundary where the previous block selection ended
                                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                                            let sourceIndex = -1;
                                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                                const item = swapChain[i];
                                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                                if (!alreadyInLast) {
                                                                                                    sourceIndex = i;
                                                                                                    break;
                                                                                                }
                                                                                            }

                                                                                            if (sourceIndex !== -1) {
                                                                                                const source = swapChain[sourceIndex];
                                                                                                const isSource = getBlockEntries(cls, day[1], 'S10').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                                if (isSource) return '3px solid #3b82f6';
                                                                                            } else if (swapChain.length > 0) {
                                                                                                // Special case: only one selection made so far
                                                                                                const source = swapChain[0];
                                                                                                const isSource = getBlockEntries(cls, day[1], 'S10').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                                if (isSource) return '3px solid #3b82f6';
                                                                                            }

                                                                                            return '1px solid #64748b';
                                                                                        })()
                                                                                    })} id={`cell-${cls}-${day[1]}-${'S10'}`} onClick={() => {
                                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S10'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                                            if (isChainComplete) return prev;
                                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                                            const next = [...prev, ...entries];
                                                                                            if (isLoop) {
                                                                                                setIsChainComplete(true);
                                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                                            }
                                                                                            return next;
                                                                                        });
                                                                                    }}>{renderCell(day[1], 'S10')}</td>
                                                                                </>
                                                                            );
                                                                        } else {
                                                                            return (
                                                                                <>
                                                                                    <td style={ttCell({
                                                                                        background: (() => {
                                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S9') ? idx : -1).filter(i => i !== -1);
                                                                                            if (indices.length === 0) return '#1e293b';
                                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                                        })(),
                                                                                        border: (() => {
                                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                                            const last = swapChain[swapChain.length - 1];
                                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                                            const isDest = getBlockEntries(cls, day[1], 'S9').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                                            // Source check: find the boundary where the previous block selection ended
                                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                                            let sourceIndex = -1;
                                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                                const item = swapChain[i];
                                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                                if (!alreadyInLast) {
                                                                                                    sourceIndex = i;
                                                                                                    break;
                                                                                                }
                                                                                            }

                                                                                            if (sourceIndex !== -1) {
                                                                                                const source = swapChain[sourceIndex];
                                                                                                const isSource = getBlockEntries(cls, day[1], 'S9').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                                if (isSource) return '3px solid #3b82f6';
                                                                                            } else if (swapChain.length > 0) {
                                                                                                // Special case: only one selection made so far
                                                                                                const source = swapChain[0];
                                                                                                const isSource = getBlockEntries(cls, day[1], 'S9').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                                if (isSource) return '3px solid #3b82f6';
                                                                                            }

                                                                                            return '1px solid #64748b';
                                                                                        })()
                                                                                    })} id={`cell-${cls}-${day[1]}-${'S9'}`} onClick={() => {
                                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S9'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                                            if (isChainComplete) return prev;
                                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                                            const next = [...prev, ...entries];
                                                                                            if (isLoop) {
                                                                                                setIsChainComplete(true);
                                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                                            }
                                                                                            return next;
                                                                                        });
                                                                                    }}>{renderCell(day[1], 'S9')}</td>
                                                                                    {i === 0 ? (
                                                                                        <td rowSpan={DAYS.length} style={ttCellBreak('LUNCH', DAYS.length)}>
                                                                                            <span style={{ fontStyle: 'italic', fontWeight: 700, fontSize: '1.2rem', color: '#38bdf8', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>LUNCH</span>
                                                                                        </td>
                                                                                    ) : null}
                                                                                </>
                                                                            );
                                                                        }
                                                                    })()}

                                                                    <td style={ttCell({
                                                                        background: (() => {
                                                                            const indices = swapChain.map((s, idx) => (s.cls === cls && s.day === day[1] && s.period === 'S11') ? idx : -1).filter(i => i !== -1);
                                                                            if (indices.length === 0) return '#1e293b';
                                                                            if (isChainComplete) return 'rgba(16, 185, 129, 0.6)';
                                                                            if (indices.some(idx => idx > 0 && idx < swapChain.length - 1)) return 'rgba(16, 185, 129, 0.25)';
                                                                            if (indices.some(idx => idx < swapChain.length - 2)) return 'rgba(59, 130, 246, 0.25)';
                                                                            return 'rgba(251, 191, 36, 0.4)';
                                                                        })(),
                                                                        border: (() => {
                                                                            if (swapChain.length === 0) return '1px solid #64748b';
                                                                            const last = swapChain[swapChain.length - 1];
                                                                            // Dest check: does this period match the block of the last item in chain?
                                                                            const isDest = getBlockEntries(cls, day[1], 'S11').some(e => e.cls === last.cls && e.day === last.day && e.period === last.period);
                                                                            if (isDest && swapChain.length >= 2) return '3px solid #10b981';

                                                                            // Source check: find the boundary where the previous block selection ended
                                                                            // If the last selection was a block of 2, the source is at swapChain[length-3] etc.
                                                                            // Simplified: Use the last selection as Dest, and the selection BEFORE it as Source.

                                                                            // Find the most recent unique block in the chain that isn't the current last block
                                                                            let sourceIndex = -1;
                                                                            const lastBlockEntries = getBlockEntries(last.cls, last.day, last.period);
                                                                            for (let i = swapChain.length - 1; i >= 0; i--) {
                                                                                const item = swapChain[i];
                                                                                const alreadyInLast = lastBlockEntries.some(e => e.cls === item.cls && e.day === item.day && e.period === item.period);
                                                                                if (!alreadyInLast) {
                                                                                    sourceIndex = i;
                                                                                    break;
                                                                                }
                                                                            }

                                                                            if (sourceIndex !== -1) {
                                                                                const source = swapChain[sourceIndex];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S11').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            } else if (swapChain.length > 0) {
                                                                                // Special case: only one selection made so far
                                                                                const source = swapChain[0];
                                                                                const isSource = getBlockEntries(cls, day[1], 'S11').some(e => e.cls === source.cls && e.day === source.day && e.period === source.period);
                                                                                if (isSource) return '3px solid #3b82f6';
                                                                            }

                                                                            return '1px solid #64748b';
                                                                        })()
                                                                    })} id={`cell-${cls}-${day[1]}-${'S11'}`} onClick={() => {
                                                                        if (!chainSwapMode || isChainComplete) return; const entries = getBlockEntries(cls, day[1], 'S11'); setSwapChainSteps(prev_steps => [...prev_steps, entries.length]); setSwapChain(prev => {
                                                                            if (isChainComplete) return prev;
                                                                            const isLoop = prev.length > 0 && entries.some(e => e.cls === prev[0].cls && e.day === prev[0].day && e.period === prev[0].period);
                                                                            const next = [...prev, ...entries];
                                                                            if (isLoop) {
                                                                                setIsChainComplete(true);
                                                                                console.log('CHAIN COMPLETE (LOOPED!)');
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}>{renderCell(day[1], 'S11')}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {isChainComplete && (
                                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(12px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', animation: 'fadeIn 0.3s ease-out' }}>
                                        <div style={{ background: '#1e293b', border: chainValidation?.success ? '2px solid #10b981' : '2px solid #ef4444', borderRadius: '1.5rem', padding: '2.5rem', maxWidth: '600px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{chainValidation?.success ? '✅' : '❌'}</div>

                                            {chainValidation?.success ? (
                                                <h2 style={{ color: '#10b981', fontSize: '2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Validation Passed</h2>
                                            ) : (
                                                <h2 style={{ color: '#ef4444', fontSize: '2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Validation Failed</h2>
                                            )}

                                            <p style={{ color: '#94a3b8', fontSize: '1rem', marginBottom: '1.5rem' }}>
                                                {chainValidation?.success
                                                    ? "All resource checks passed. Ready to commit the changes."
                                                    : "Conflicts detected in DPT or Lab resources. Please resolve them to proceed."}
                                            </p>

                                            {!chainValidation?.success && chainValidation?.conflicts.length > 0 && (
                                                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                                                    <h3 style={{ color: '#ef4444', marginBottom: '0.8rem', fontWeight: 800, fontSize: '0.9rem' }}>Conflicts detected:</h3>
                                                    <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                                        {chainValidation.conflicts.map((c, i) => (
                                                            <div key={i} style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '0.4rem', paddingLeft: '1rem', position: 'relative' }}>
                                                                <span style={{ position: 'absolute', left: 0 }}>•</span> {c}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {chainValidation?.success && (
                                                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                                                    <div style={{ color: '#a7f3d0', fontSize: '0.9rem' }}>
                                                        <div style={{ marginBottom: '0.3rem' }}>✓ DPT Check: All teachers available</div>
                                                        <div style={{ marginBottom: '0.3rem' }}>✓ Lab Check: All resources available</div>
                                                        <div>✓ Class Check: All slots available</div>
                                                    </div>
                                                </div>
                                            )}

                                            <div style={{ background: '#0f172a', borderRadius: '1rem', padding: '1rem', marginBottom: '2rem', textAlign: 'left', border: '1px solid #334155', maxHeight: '150px', overflowY: 'auto' }}>
                                                <h4 style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chain Sequence:</h4>
                                                {swapChain.map((p, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.4rem 0', borderBottom: i < swapChain.length - 1 ? '1px dashed #334155' : 'none' }}>
                                                        <span style={{ color: '#10b981', fontWeight: 900, fontSize: '0.8rem', width: '20px' }}>{i + 1}.</span>
                                                        <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>{p.cls}</span>
                                                        <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{p.day}</span>
                                                        <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.85rem' }}>{getPeriodLabel(p.cls, p.period)}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                                <button
                                                    onClick={() => {
                                                        setSwapChain([]);
                                                        setSwapChainSteps([]);
                                                        setIsChainComplete(false);
                                                    }}
                                                    style={{ background: '#334155', color: 'white', border: 'none', padding: '0.8rem 1.8rem', borderRadius: '0.7rem', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
                                                >Cancel</button>
                                                <button
                                                    onClick={executeChainSwap}
                                                    disabled={!chainValidation?.success}
                                                    style={{
                                                        background: chainValidation?.success ? '#f97316' : '#1e293b',
                                                        color: 'white', border: 'none', padding: '0.8rem 2rem',
                                                        borderRadius: '0.7rem', fontSize: '1rem', fontWeight: 900,
                                                        cursor: chainValidation?.success ? 'pointer' : 'not-allowed',
                                                        transition: 'all 0.2s',
                                                        boxShadow: chainValidation?.success ? '0 4px 12px rgba(249,115,22,0.3)' : 'none',
                                                        opacity: chainValidation?.success ? 1 : 0.5,
                                                        border: chainValidation?.success ? 'none' : '1px solid #334155'
                                                    }}
                                                >Execute Swap</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()
                }

                {/* Tab 4: Subject Period Distribution */}
                {
                    activeTab === 2 && (
                        <div>
                            <button
                                onClick={() => {
                                    localStorage.setItem('tt_distribution_47', JSON.stringify(distribution47));
                                    addToast('Saved', 'success');
                                }}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    background: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.75rem',
                                    cursor: 'pointer',
                                    marginBottom: '1.5rem',
                                    display: 'block'
                                }}
                            >
                                💾 Save
                            </button>
                            {/* Header with Title and Actions */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '1.5rem',
                                flexWrap: 'wrap',
                                gap: '1rem'
                            }}>
                                <div>
                                    <h3 style={{ fontSize: '1.3rem', fontWeight: '600', color: '#f1f5f9' }}>
                                        📊 Subject Period Distribution - 47 Classrooms
                                    </h3>
                                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                        Click any cell to edit • Bulk select with checkboxes • Shift+click for range
                                    </p>
                                </div>

                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    <button
                                        onClick={() => setShowAddSubject(true)}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#4f46e5',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}
                                    >
                                        ➕ ADD NEW SUBJECT
                                    </button>

                                    <button
                                        onClick={() => {
                                            console.log('Manual sync triggered');
                                            const updated = syncSubjectsFromMappings(
                                                { ...distribution47 },
                                                teacherSubjectMappings
                                            );
                                            setDistribution47(updated);
                                            saveDistribution(updated);
                                            addToast('✅ Subjects synced from Tab 3!', 'success');
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#2563eb',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}
                                    >
                                        🔄 SYNC FROM TAB 3
                                    </button>

                                    <button
                                        onClick={() => {
                                            saveDistribution(distribution47);
                                            addToast('✅ Period distribution saved for 47 classrooms!', 'success');
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.5rem',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}
                                    >
                                        💾 SAVE DISTRIBUTION
                                    </button>
                                </div>
                            </div>

                            {/* Add New Subject Modal */}
                            {showAddSubject && (
                                <div style={{
                                    background: '#1e293b',
                                    borderRadius: '0.75rem',
                                    padding: '1.5rem',
                                    marginBottom: '1.5rem',
                                    border: '2px solid #4f46e5'
                                }}>
                                    <h4 style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
                                        Add New Subject
                                    </h4>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            value={newSubjectName}
                                            onChange={(e) => setNewSubjectName(e.target.value)}
                                            placeholder="Enter subject name (e.g. 'ECONOMICS')"
                                            style={{
                                                flex: 1,
                                                padding: '0.75rem 1rem',
                                                background: '#0f172a',
                                                border: '1px solid #4f46e5',
                                                borderRadius: '0.5rem',
                                                color: '#f1f5f9',
                                                fontSize: '1rem'
                                            }}
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => {
                                                if (newSubjectName.trim()) {
                                                    const subject = newSubjectName.trim().toUpperCase();
                                                    let updated = { ...distribution47 };
                                                    // Initialize with zeros for all classes
                                                    ALL_CLASSES.forEach(className => {
                                                        if (!updated[className]) updated[className] = {};
                                                        updated[className][subject] = 0;
                                                    });
                                                    setDistribution47(updated);
                                                    saveDistribution(updated);
                                                    setNewSubjectName('');
                                                    setShowAddSubject(false);
                                                }
                                            }}
                                            style={{
                                                padding: '0.75rem 1.5rem',
                                                background: '#10b981',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '0.5rem',
                                                fontWeight: '600',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            ADD
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowAddSubject(false);
                                                setNewSubjectName('');
                                            }}
                                            style={{
                                                padding: '0.75rem 1.5rem',
                                                background: '#64748b',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '0.5rem',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            CANCEL
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Bulk Edit Toolbar */}
                            <div style={{
                                background: '#1e293b',
                                borderRadius: '0.75rem',
                                padding: '1rem 1.5rem',
                                marginBottom: '1.5rem',
                                border: '1px solid #4f46e5',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1.5rem',
                                flexWrap: 'wrap'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{ color: '#f1f5f9', fontWeight: '500' }}>BULK EDIT:</span>
                                    <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                                        {selectedClasses.length} classes selected
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ color: '#f1f5f9' }}>Set periods to:</span>
                                    <input
                                        type="number"
                                        value={bulkPeriodValue}
                                        onChange={(e) => setBulkPeriodValue(e.target.value)}
                                        min="0"
                                        max="8"
                                        style={{
                                            width: '60px',
                                            padding: '0.5rem',
                                            background: '#0f172a',
                                            border: '1px solid #334155',
                                            borderRadius: '0.375rem',
                                            color: '#f1f5f9',
                                            textAlign: 'center'
                                        }}
                                    />
                                    <button
                                        onClick={handleBulkApply}
                                        disabled={!currentBulkSubject || selectedClasses.length === 0}
                                        style={{
                                            padding: '0.5rem 1.25rem',
                                            background: !currentBulkSubject || selectedClasses.length === 0 ? '#64748b' : '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: '600',
                                            cursor: !currentBulkSubject || selectedClasses.length === 0 ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        APPLY TO SELECTED
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {['6', '7', '8', '9', '10', '11', '12'].map(grade => (
                                        <button
                                            key={grade}
                                            onClick={() => handleGradeBulk(grade)}
                                            style={{
                                                padding: '0.5rem 1rem',
                                                background: '#334155',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '0.375rem',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Grade {grade}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Merge Selected Toolbar (appears when eligible) */}
                            {selectedCells.length > 1 && currentBulkSubject &&
                                selectedCells.every(c => c.subject === currentBulkSubject) &&
                                selectedCells.every(c => !isClassMerged(distribution47, currentBulkSubject, c.className)) &&
                                <div style={{
                                    marginBottom: '1rem',
                                    padding: '0.75rem 1rem',
                                    background: '#7c3aed',
                                    color: 'white',
                                    borderRadius: '0.5rem',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}>
                                    <span>{selectedCells.length} classes selected for <strong>{currentBulkSubject}</strong></span>
                                    <button
                                        onClick={() => {
                                            const answer = prompt('Enter total weekly periods for this combined group:', '5');
                                            if (answer !== null) {
                                                const total = parseInt(answer) || 0;
                                                // create merged group
                                                const classListForMerge = selectedCells.map(c => c.className);
                                                const updated = addMergedGroup(
                                                    { ...distribution47 },
                                                    currentBulkSubject,
                                                    classListForMerge,
                                                    total
                                                );
                                                // set first class raw value and clear others
                                                if (selectedCells.length > 0) {
                                                    const first = selectedCells[0].className;
                                                    updated[first][currentBulkSubject] = total;
                                                    selectedCells.slice(1).forEach(c => {
                                                        updated[c.className][currentBulkSubject] = 0;
                                                    });
                                                }
                                                setDistribution47(updated);
                                                saveDistribution(updated);
                                                setSelectedClasses([]);
                                                selectedCellsRef.current = [];
                                                setSelectedCells([]);
                                                addToast('✅ Classes merged', 'success');
                                            }
                                        }}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: '#4f46e5',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        🔗 Merge Selected
                                    </button>
                                </div>
                            }

                            {/* 47-COLUMN GRID with FROZEN SUBJECT COLUMN */}
                            <div style={{
                                background: '#1e293b',
                                borderRadius: '1rem',
                                border: '1px solid #334155',
                                overflow: 'auto',
                                maxHeight: 'calc(100vh - 300px)',
                                position: 'relative'
                            }}>
                                <table style={{
                                    width: '100%',
                                    borderCollapse: 'separate',
                                    borderSpacing: '0',
                                    minWidth: '1200px'
                                }}>
                                    {/* FROZEN HEADER ROW */}
                                    <thead style={{
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 20,
                                        background: '#0f172a'
                                    }}>
                                        <tr>
                                            {/* Checkbox Column Header */}
                                            <th style={{
                                                padding: '0.75rem 0.5rem',
                                                background: '#0f172a',
                                                borderBottom: '2px solid #4f46e5',
                                                borderRight: '1px solid #334155',
                                                position: 'sticky',
                                                left: 0,
                                                zIndex: 30,
                                                minWidth: '40px'
                                            }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedClasses.length === ALL_CLASSES.length}
                                                    onChange={handleSelectAll}
                                                    style={{
                                                        width: '18px',
                                                        height: '18px',
                                                        cursor: 'pointer',
                                                        accentColor: '#4f46e5'
                                                    }}
                                                />
                                            </th>

                                            {/* FROZEN SUBJECT COLUMN HEADER */}
                                            <th style={{
                                                padding: '1rem',
                                                textAlign: 'left',
                                                color: '#f1f5f9',
                                                fontSize: '0.95rem',
                                                background: '#0f172a',
                                                borderBottom: '2px solid #4f46e5',
                                                borderRight: '2px solid #4f46e5',
                                                position: 'sticky',
                                                left: '58px',
                                                zIndex: 25,
                                                minWidth: '180px'
                                            }}>
                                                SUBJECT
                                            </th>

                                            {/* ALL 47 CLASS COLUMN HEADERS */}
                                            {ALL_CLASSES.map(className => (
                                                <th key={className} style={{
                                                    padding: '0.75rem 0.5rem',
                                                    textAlign: 'center',
                                                    color: className.includes('11') || className.includes('12') ? '#d97706' : '#06b6d4',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    background: '#0f172a',
                                                    borderBottom: '2px solid #4f46e5',
                                                    borderLeft: '1px solid #334155',
                                                    minWidth: '50px',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {className}
                                                </th>
                                            ))}

                                            {/* Actions Column Header */}
                                            <th style={{
                                                padding: '0.75rem 1rem',
                                                background: '#0f172a',
                                                borderBottom: '2px solid #4f46e5',
                                                borderLeft: '1px solid #334155',
                                                minWidth: '80px',
                                                color: '#f1f5f9',
                                                fontSize: '0.85rem'
                                            }}>
                                                ACTIONS
                                            </th>
                                        </tr>
                                    </thead>

                                    {/* TABLE BODY - SUBJECT ROWS */}
                                    <tbody>
                                        {getAllSubjects(distribution47).map((subject) => (
                                            <tr
                                                key={subject}
                                                style={{
                                                    borderBottom: '1px solid #334155',
                                                    background: subject === currentBulkSubject ? 'rgba(79, 70, 229, 0.1)' : 'transparent'
                                                }}
                                            >
                                                {/* Checkbox Cell - FROZEN */}
                                                <td style={{
                                                    padding: '0.75rem 0.5rem',
                                                    background: '#1e293b',
                                                    borderRight: '1px solid #334155',
                                                    position: 'sticky',
                                                    left: 0,
                                                    zIndex: 10,
                                                    textAlign: 'center'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedSubjects.has(subject)}
                                                        onChange={() => handleSubjectSelect(subject)}
                                                        style={{
                                                            width: '18px',
                                                            height: '18px',
                                                            cursor: 'pointer',
                                                            accentColor: '#4f46e5'
                                                        }}
                                                    />
                                                </td>

                                                {/* FROZEN SUBJECT COLUMN */}
                                                <td style={{
                                                    padding: '0.75rem 1rem',
                                                    background: subject === currentBulkSubject ? 'rgba(79, 70, 229, 0.2)' : '#1e293b',
                                                    borderRight: '2px solid #4f46e5',
                                                    position: 'sticky',
                                                    left: '58px',
                                                    zIndex: 5,
                                                    fontWeight: '500',
                                                    color: '#f1f5f9'
                                                }}>
                                                    {editingSubjectName === subject ? (
                                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                            <input
                                                                type="text"
                                                                value={subjectRenameValue}
                                                                onChange={(e) => setSubjectRenameValue(e.target.value)}
                                                                style={{
                                                                    padding: '0.4rem 0.75rem',
                                                                    background: '#0f172a',
                                                                    border: '1px solid #4f46e5',
                                                                    borderRadius: '0.375rem',
                                                                    color: '#f1f5f9',
                                                                    fontSize: '0.95rem',
                                                                    width: '140px'
                                                                }}
                                                                autoFocus
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    if (subjectRenameValue.trim() && subjectRenameValue !== subject) {
                                                                        const updated = renameSubject(
                                                                            { ...distribution47 },
                                                                            subject,
                                                                            subjectRenameValue.trim().toUpperCase()
                                                                        );
                                                                        setDistribution47(updated);
                                                                        saveDistribution(updated);
                                                                    }
                                                                    setEditingSubjectName(null);
                                                                    setSubjectRenameValue('');
                                                                }}
                                                                style={{
                                                                    padding: '0.4rem 0.8rem',
                                                                    background: '#10b981',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '0.375rem',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                ✓
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingSubjectName(null);
                                                                    setSubjectRenameValue('');
                                                                }}
                                                                style={{
                                                                    padding: '0.4rem 0.8rem',
                                                                    background: '#64748b',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '0.375rem',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                ✗
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                            <span
                                                                style={{
                                                                    color: '#f1f5f9',
                                                                    fontWeight: '600',
                                                                    cursor: 'pointer',
                                                                    padding: '0.25rem 0.5rem',
                                                                    borderRadius: '0.25rem'
                                                                }}
                                                                onClick={() => {
                                                                    setEditingSubjectName(subject);
                                                                    setSubjectRenameValue(subject);
                                                                    setCurrentBulkSubject(subject);
                                                                }}
                                                                onMouseEnter={(e) => e.target.style.background = '#334155'}
                                                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                                            >
                                                                {subject}
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    if (confirm(`Delete subject "${subject}" from ALL 47 classes? This cannot be undone.`)) {
                                                                        const updated = deleteSubject({ ...distribution47 }, subject);
                                                                        setDistribution47(updated);
                                                                        saveDistribution(updated);
                                                                        if (currentBulkSubject === subject) setCurrentBulkSubject(null);
                                                                    }
                                                                }}
                                                                style={{
                                                                    padding: '0.25rem 0.5rem',
                                                                    background: 'transparent',
                                                                    color: '#ef4444',
                                                                    border: '1px solid #ef4444',
                                                                    borderRadius: '0.25rem',
                                                                    fontSize: '0.75rem',
                                                                    cursor: 'pointer',
                                                                    opacity: 0.7
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.target.style.opacity = '1';
                                                                    e.target.style.background = '#ef4444';
                                                                    e.target.style.color = 'white';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.target.style.opacity = '0.7';
                                                                    e.target.style.background = 'transparent';
                                                                    e.target.style.color = '#ef4444';
                                                                }}
                                                            >
                                                                🗑️
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>

                                                {/* 47 CLASS CELLS - EDITABLE PERIOD COUNTS */}
                                                {ALL_CLASSES.map(className => {
                                                    const cellKey = `${subject}-${className}`;
                                                    const isEditing = editingCell === cellKey;
                                                    const rawValue = getValue(distribution47, subject, className);
                                                    const group = getGroupForClass(distribution47, subject, className);
                                                    const isMerged = !!group;
                                                    const isFirst = group && group.classes[0] === className;
                                                    const displayValue = isMerged
                                                        ? (isFirst ? `${group.total} periods` : `↳ ${group.total}`)
                                                        : rawValue;
                                                    const bgColor = isMerged ? '#9333ea' : (rawValue > 0 ? '#4f46e5' : 'transparent');
                                                    const textColor = isMerged ? 'white' : (rawValue > 0 ? 'white' : '#94a3b8');

                                                    return (
                                                        <td
                                                            key={className}
                                                            style={{
                                                                padding: '0.5rem 0.25rem',
                                                                textAlign: 'center',
                                                                background: selectedCells.some(c => c.subject === subject && c.className === className) ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
                                                                borderLeft: '1px solid #334155',
                                                                cursor: 'pointer'
                                                            }}
                                                            onMouseDown={(e) => {
                                                                if (e.ctrlKey || e.metaKey) {
                                                                    toggleCtrlSelect(subject, className);
                                                                    setMouseDown(true);
                                                                    ctrlSelecting.current = true; // remember to suppress click
                                                                } else {
                                                                    ctrlSelecting.current = false;
                                                                }
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                if (mouseDown && (e.ctrlKey || e.metaKey)) {
                                                                    toggleCtrlSelect(subject, className);
                                                                }
                                                            }}
                                                            onClick={(e) => {
                                                                // Handle shift+click range selection
                                                                if (e.shiftKey && lastSelectedClass) {
                                                                    const start = ALL_CLASSES.indexOf(lastSelectedClass);
                                                                    const end = ALL_CLASSES.indexOf(className);
                                                                    const [min, max] = [Math.min(start, end), Math.max(start, end)];
                                                                    const range = ALL_CLASSES.slice(min, max + 1);
                                                                    setSelectedClasses(prev => {
                                                                        const newSelection = [...new Set([...prev, ...range])];
                                                                        return newSelection;
                                                                    });
                                                                    // if we're merging within a subject, also add to selectedCells
                                                                    if (currentBulkSubject && currentBulkSubject === subject) {
                                                                        setSelectedCells(prev => {
                                                                            const added = range.map(cn => ({ subject, className: cn }));
                                                                            // merge unique
                                                                            const all = [...prev, ...added];
                                                                            const uniq = [];
                                                                            all.forEach(x => {
                                                                                if (!uniq.find(y => y.subject === x.subject && y.className === x.className)) {
                                                                                    uniq.push(x);
                                                                                }
                                                                            });
                                                                            selectedCellsRef.current = uniq;
                                                                            return uniq;
                                                                        });
                                                                    }
                                                                }
                                                                setLastSelectedClass(className);
                                                            }}
                                                        >
                                                            {isEditing ? (
                                                                <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                                                                    <input
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(e.target.value)}
                                                                        onBlur={() => {
                                                                            let updated = { ...distribution47 };
                                                                            if (isMerged && isFirst) {
                                                                                // change group total
                                                                                const grp = getGroupForClass(updated, subject, className);
                                                                                if (grp) {
                                                                                    grp.total = parseInt(editValue) || 0;
                                                                                    // also mirror value in the first cell
                                                                                    updated[className][subject] = grp.total;
                                                                                }
                                                                            } else {
                                                                                updated = setValue(updated, subject, className, editValue);
                                                                            }
                                                                            setDistribution47(updated);
                                                                            saveDistribution(updated);
                                                                            setEditingCell(null);
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') {
                                                                                let updated = { ...distribution47 };
                                                                                if (isMerged && isFirst) {
                                                                                    const grp = getGroupForClass(updated, subject, className);
                                                                                    if (grp) {
                                                                                        grp.total = parseInt(editValue) || 0;
                                                                                        updated[className][subject] = grp.total;
                                                                                    }
                                                                                } else {
                                                                                    updated = setValue(updated, subject, className, editValue);
                                                                                }
                                                                                setDistribution47(updated);
                                                                                saveDistribution(updated);
                                                                                setEditingCell(null);
                                                                            }
                                                                        }}
                                                                        min="0"
                                                                        max="8"
                                                                        style={{
                                                                            width: '45px',
                                                                            padding: '0.3rem',
                                                                            background: '#0f172a',
                                                                            border: '2px solid #4f46e5',
                                                                            borderRadius: '0.25rem',
                                                                            color: '#f1f5f9',
                                                                            textAlign: 'center',
                                                                            fontWeight: '600'
                                                                        }}
                                                                        autoFocus
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <div
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // if previous mousedown triggered ctrl-selection, do not start edit
                                                                        if (ctrlSelecting.current) {
                                                                            ctrlSelecting.current = false;
                                                                            return;
                                                                        }
                                                                        if (e.ctrlKey || e.metaKey) {
                                                                            // ignore ctrl-clicks to avoid toggling edit mode
                                                                            return;
                                                                        }
                                                                        if (isMerged && !isFirst) return; // don't edit non-first merged cells
                                                                        // normal click goes into edit mode; selection handled separately on mouseDown
                                                                        setSelectedClasses([]);
                                                                        selectedCellsRef.current = [];
                                                                        setSelectedCells([]);
                                                                        setEditingCell(cellKey);
                                                                        setEditValue(rawValue);
                                                                        setCurrentBulkSubject(subject);
                                                                    }}
                                                                    style={{
                                                                        padding: '0.5rem 0.25rem',
                                                                        background: bgColor,
                                                                        color: textColor,
                                                                        borderRadius: '0.25rem',
                                                                        fontWeight: isMerged || rawValue > 0 ? '600' : '400',
                                                                        transition: 'all 0.1s',
                                                                        width: '100%',
                                                                        textAlign: 'center',
                                                                        position: 'relative'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        if (!isMerged && rawValue === 0) {
                                                                            e.target.style.background = '#334155';
                                                                        }
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        if (!isMerged && rawValue === 0) {
                                                                            e.target.style.background = 'transparent';
                                                                        }
                                                                    }}
                                                                >
                                                                    {displayValue}
                                                                    {/* demerge button on first cell */}
                                                                    {isMerged && isFirst && (
                                                                        <button
                                                                            onClick={(ev) => {
                                                                                ev.stopPropagation();
                                                                                if (confirm('Remove merged group?')) {
                                                                                    const grp = getGroupForClass(distribution47, subject, className);
                                                                                    let updated = { ...distribution47 };
                                                                                    updated = removeMergedGroup(updated, subject, grp.id);
                                                                                    // reset individual values to zero
                                                                                    grp.classes.forEach(cl => {
                                                                                        updated[cl][subject] = 0;
                                                                                    });
                                                                                    setDistribution47(updated);
                                                                                    saveDistribution(updated);
                                                                                    setSelectedClasses([]);
                                                                                }
                                                                            }}
                                                                            style={{
                                                                                position: 'absolute',
                                                                                top: '2px',
                                                                                right: '2px',
                                                                                background: 'transparent',
                                                                                color: 'white',
                                                                                border: 'none',
                                                                                fontSize: '0.7rem',
                                                                                cursor: 'pointer',
                                                                                padding: '0',
                                                                                lineHeight: '1'
                                                                            }}
                                                                            title="Demerge group"
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                {/* Actions Cell */}
                                                <td style={{
                                                    padding: '0.75rem',
                                                    textAlign: 'center',
                                                    borderLeft: '1px solid #334155'
                                                }}>
                                                    <button
                                                        onClick={() => {
                                                            setCurrentBulkSubject(subject);
                                                            addToast(`Selected subject: ${subject}. Use bulk edit toolbar to set periods.`, 'success');
                                                        }}
                                                        style={{
                                                            padding: '0.4rem 0.8rem',
                                                            background: currentBulkSubject === subject ? '#4f46e5' : '#334155',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '0.375rem',
                                                            fontSize: '0.75rem',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        ✎ Bulk
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {getAllSubjects(distribution47).length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                                        <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No subjects yet</p>
                                        <p style={{ fontSize: '0.95rem' }}>Add subjects from Tab 3 or click "ADD NEW SUBJECT" above</p>
                                    </div>
                                )}
                            </div>

                            {/* Lab Timetable System Section */}
                            <div style={{ marginTop: '4rem', padding: '2rem', background: '#1e293b', borderRadius: '1rem', border: '1px solid #334155' }}>
                                <h3 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#f1f5f9', marginBottom: '2rem', textAlign: 'center', borderBottom: '3px solid #4f46e5', paddingBottom: '10px' }}>
                                    🔬 Lab Timetable Management System
                                </h3>

                                {generatedTimetable?.labTimetables ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                        {Object.entries(generatedTimetable.labTimetables).map(([labName, timetable]) => (
                                            <div key={labName} style={{ background: 'white', borderRadius: '0.5rem', overflow: 'hidden' }}>
                                                <div style={{ padding: '10px', background: '#334155', color: 'white', fontWeight: 900, textAlign: 'center' }}>
                                                    {labName}
                                                </div>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', color: 'black', fontSize: '0.75rem' }}>
                                                    <thead>
                                                        <tr style={{ background: '#f8fafc' }}>
                                                            <th style={{ border: '1px solid #e2e8f0', padding: '4px' }}>DAY</th>
                                                            {['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'].map(p => {
                                                                const map = { S1: 'P1', S2: 'P2', S4: 'P3', S5: 'P4', S6: 'P5', S8: 'P6', S9: 'P7', S10: 'P7', S11: 'P8' };
                                                                // Show appropriate P7 for MS/Senior
                                                                const isMS = labName === LAB_SYSTEM.MS_COMP;
                                                                if (isMS && p === 'S9') return null; // MS Lunch
                                                                if (!isMS && p === 'S10') return null; // Senior Lunch
                                                                return <th key={p} style={{ border: '1px solid #e2e8f0', padding: '4px' }}>{map[p]}</th>;
                                                            })}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                                                            <tr key={day}>
                                                                <td style={{ border: '1px solid #e2e8f0', fontWeight: 800, padding: '4px', textAlign: 'center' }}>{day.substring(0, 3)}</td>
                                                                {['S1', 'S2', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11'].map(p => {
                                                                    const isMS = labName === LAB_SYSTEM.MS_COMP;
                                                                    if (isMS && p === 'S9') return null;
                                                                    if (!isMS && p === 'S10') return null;

                                                                    const val = timetable[day][p];
                                                                    return (
                                                                        <td key={p} style={{
                                                                            border: '1px solid #e2e8f0',
                                                                            padding: '4px',
                                                                            textAlign: 'center',
                                                                            fontWeight: val !== '-' ? 900 : 400,
                                                                            background: val !== '-' ? '#f0fdf4' : 'white',
                                                                            color: val !== '-' ? '#166534' : '#64748b'
                                                                        }}>
                                                                            {val}
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#0f172a', borderRadius: '0.5rem' }}>
                                        <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>No Lab Data Available</p>
                                        <p style={{ marginTop: '0.5rem' }}>Generate a timetable to see lab occupancy</p>
                                    </div>
                                )}
                            </div>

                            {/* Legend and Stats */}
                            <div style={{
                                marginTop: '1.5rem',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                color: '#94a3b8',
                                fontSize: '0.85rem',
                                borderTop: '1px solid #334155',
                                paddingTop: '1rem'
                            }}>
                                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                    <span>📘 <span style={{ color: '#4f46e5' }}>Blue cells</span> = Subject taught</span>
                                    <span>📗 <span style={{ color: '#06b6d4' }}>Teal headers</span> = Grades 6-10</span>
                                    <span>📙 <span style={{ color: '#d97706' }}>Orange headers</span> = Grades 11-12</span>
                                    <span>✅ <span style={{ color: '#10b981' }}>Bulk edit</span> = Select classes → Set value → Apply</span>
                                    <span>🔗 <span style={{ color: '#9333ea' }}>Purple cells</span> = Merged group</span>
                                </div>
                                <div>
                                    Total subjects: {getAllSubjects(distribution47).length} | Total classes: 47
                                </div>
                            </div>
                            {/* Merge summary list */}
                            {Object.keys(getMergedGroups(distribution47)).length > 0 && (
                                <div style={{ marginTop: '1rem', color: '#d1d5db', fontSize: '0.9rem' }}>
                                    <strong>Combined groups:</strong>
                                    <ul style={{ marginLeft: '1rem', marginTop: '0.25rem' }}>
                                        {Object.entries(getMergedGroups(distribution47)).map(([subject, groups]) =>
                                            groups.map(g => (
                                                <li key={g.id}>
                                                    {subject}: {g.classes.join(' + ')} = {g.total} periods/week
                                                </li>
                                            ))
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )
                }

                {/* Tab 3: DPT (Day, Period, Time) */}
                {
                    activeTab === 3 && (() => {
                        const DPT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        const DPT_PERIODS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];
                        const DPT_DAY_SHORT = { Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT' };

                        if (!generatedTimetable) {
                            return (
                                <div style={{ animation: 'fadeIn 0.3s ease-out', textAlign: 'center', padding: '5rem 2rem' }}>
                                    <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🕒</div>
                                    <h2 style={{ color: '#f1f5f9', fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.75rem' }}>DPT — Availability & Engagement</h2>
                                    <p style={{ color: '#64748b', fontSize: '1rem' }}>Generate a timetable first to see the DPT view.</p>
                                </div>
                            );
                        }

                        const teacherSubjectMap = {};
                        mappingRows.forEach(m => {
                            if (m.teacher) teacherSubjectMap[m.teacher.trim()] = m.subjects?.[0] || '';
                        });
                        allotmentRows.forEach(r => {
                            if (r.teacher && !teacherSubjectMap[r.teacher.trim()]) {
                                teacherSubjectMap[r.teacher.trim()] = r.subject || r.allotments?.[0]?.subject || '';
                            }
                        });

                        const teacherNames = Object.keys(generatedTimetable.teacherTimetables || {}).sort((a, b) => {
                            const subA = (teacherSubjectMap[a.trim()] || '').toUpperCase();
                            const subB = (teacherSubjectMap[b.trim()] || '').toUpperCase();
                            if (subA !== subB) {
                                if (!subA) return 1;
                                if (!subB) return -1;
                                return subA.localeCompare(subB);
                            }
                            return a.trim().localeCompare(b.trim());
                        });

                        const classNames = Object.keys(generatedTimetable.classTimetables || {}).sort((a, b) => {
                            const numA = parseInt(a) || 0;
                            const numB = parseInt(b) || 0;
                            if (numA !== numB) return numA - numB;
                            return a.localeCompare(b);
                        });

                        // For each teacher/day/period → get className or null
                        const getTeacherEngagement = (teacher, day, period) => {
                            const slot = generatedTimetable.teacherTimetables?.[teacher]?.[day]?.[period];
                            if (!slot || !slot.className) return null;
                            let tag = '';
                            if (slot.isStream) tag = ' [S]';
                            else if (slot.isTBlock) tag = ' [T]';
                            else if (slot.isLBlock) tag = ' [L]';
                            return slot.className + tag;
                        };

                        const getClassEngagement = (clsName, day, period) => {
                            const slot = generatedTimetable.classTimetables?.[clsName]?.[day]?.[period];
                            if (!slot || !slot.subject) return null;
                            const label = slot.isStream ? (slot.streamName || slot.subject) : slot.subject;
                            let tag = '';
                            if (slot.isStream) tag = ' [S]';
                            else if (slot.isTBlock) tag = ' [T]';
                            else if (slot.isLBlock) tag = ' [L]';
                            const labelAbbr = getAbbreviation(label);
                            return labelAbbr + tag;
                        };

                        const getTooltip = (item, day, period, type) => {
                            if (type === 'Teachers') {
                                const slot = generatedTimetable.teacherTimetables?.[item]?.[day]?.[period];
                                if (!slot) return `${item} FREE (${day} ${period})`;
                                if (slot.isStream) {
                                    return `[STREAM] ${item} teaching ${slot.subject} for Group: ${slot.groupName || 'N/A'} in Class ${slot.className}`;
                                }
                                return `${item} teaching ${slot.subject} in Class ${slot.className}`;
                            } else {
                                const slot = generatedTimetable.classTimetables?.[item]?.[day]?.[period];
                                if (!slot) return `${item} FREE (${day} ${period})`;
                                if (slot.isStream) {
                                    let details = (slot.subjects || []).map(s => `${s.groupName || s.subject}: ${s.teacher}`).join('\n');
                                    return `${slot.streamName || slot.subject} Period\n${details}`;
                                }
                                return `${slot.subject} by ${slot.teacher}`;
                            }
                        };

                        // Count busy periods with breakdown
                        const getBusyDetails = (item, type) => {
                            let normal = 0;
                            let stream = 0;
                            DPT_DAYS.forEach(day => {
                                DPT_PERIODS.forEach(p => {
                                    if (type === 'Teachers') {
                                        const slot = generatedTimetable.teacherTimetables?.[item]?.[day]?.[p];
                                        if (slot && slot.className) {
                                            if (slot.isStream) stream++;
                                            else normal++;
                                        }
                                    } else {
                                        const slot = generatedTimetable.classTimetables?.[item]?.[day]?.[p];
                                        if (slot && slot.subject) {
                                            if (slot.isStream) stream++;
                                            else normal++;
                                        }
                                    }
                                });
                            });
                            return { total: normal + stream, normal, stream };
                        };

                        const rowItems = dptViewType === 'Teachers' ? teacherNames : classNames;

                        const cellBase = {
                            width: '42px', minWidth: '42px', height: '38px',
                            textAlign: 'center', verticalAlign: 'middle',
                            fontSize: '0.62rem', fontWeight: 700,
                            border: '1px solid #1e293b',
                            borderRadius: '4px',
                            padding: '2px',
                            transition: 'background 0.15s',
                            cursor: 'help'
                        };

                        return (
                            <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                                {/* Header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                                    <div>
                                        <h2 style={{ color: '#f1f5f9', fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>🕒 DPT — {dptViewType} View</h2>
                                        <p style={{ color: '#64748b', fontSize: '0.82rem', margin: '0.2rem 0 0 0' }}>
                                            {dptViewType === 'Teachers' ? 'Showing class engagement per teacher.' : 'Showing subject engagement per class.'}
                                        </p>
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {/* View Toggle */}
                                        <div style={{ background: '#1e293b', padding: '0.3rem', borderRadius: '0.75rem', display: 'flex', gap: '0.3rem', border: '1px solid #334155' }}>
                                            {['Teachers', 'Classes'].map(type => (
                                                <button
                                                    key={type}
                                                    onClick={() => setDptViewType(type)}
                                                    style={{
                                                        padding: '0.4rem 1rem',
                                                        background: dptViewType === type ? 'linear-gradient(135deg, #4f46e5, #4338ca)' : 'transparent',
                                                        border: 'none',
                                                        borderRadius: '0.5rem',
                                                        color: dptViewType === type ? 'white' : '#94a3b8',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 800,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >{type}</button>
                                            ))}
                                        </div>

                                        {/* Legend */}
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: '#94a3b8' }}>
                                                <span style={{ display: 'inline-block', width: 14, height: 14, background: 'rgba(79,70,229,0.25)', border: '1px solid #4f46e5', borderRadius: 3 }}></span>
                                                Busy
                                            </span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: '#94a3b8' }}>
                                                <span style={{ display: 'inline-block', width: 14, height: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3 }}></span>
                                                Free
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Table */}
                                <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid #334155', maxHeight: '70vh' }}>
                                    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'auto' }}>
                                        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                                            {/* Row 1: Item Name + Day group headers */}
                                            <tr>
                                                <th rowSpan={2} style={{
                                                    position: 'sticky', left: 0, zIndex: 3,
                                                    background: '#0f172a', color: '#818cf8',
                                                    fontSize: '0.72rem', fontWeight: 800,
                                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                                    padding: '0.6rem 1rem', textAlign: 'left',
                                                    borderRight: '2px solid #334155', borderBottom: '2px solid #334155',
                                                    minWidth: '160px', whiteSpace: 'nowrap'
                                                }}>
                                                    {dptViewType === 'Teachers' ? 'Teacher' : 'Class'}
                                                </th>
                                                <th rowSpan={2} style={{
                                                    background: '#0f172a', color: '#64748b',
                                                    fontSize: '0.65rem', fontWeight: 700,
                                                    padding: '0.4rem 0.5rem', textAlign: 'center',
                                                    borderRight: '1px solid #334155', borderBottom: '2px solid #334155',
                                                    whiteSpace: 'nowrap'
                                                }}>Total</th>
                                                {DPT_DAYS.map(day => (
                                                    <th key={day} colSpan={12} style={{
                                                        background: '#1e293b', color: '#a5b4fc',
                                                        fontSize: '0.7rem', fontWeight: 800,
                                                        padding: '0.4rem 0', textAlign: 'center',
                                                        borderLeft: '2px solid #334155',
                                                        borderBottom: '1px solid #334155',
                                                        letterSpacing: '0.07em'
                                                    }}>
                                                        {DPT_DAY_SHORT[day]}
                                                    </th>
                                                ))}
                                            </tr>
                                            {/* Row 2: P1–P8 sub-headers per day */}
                                            <tr>
                                                {DPT_DAYS.map(day => (
                                                    DPT_PERIODS.map((p, pi) => {
                                                        let label = p;
                                                        if (p === 'S1') label = 'P1';
                                                        else if (p === 'S2') label = 'P2';
                                                        else if (p === 'S3') label = 'BRK';
                                                        else if (p === 'S4') label = 'P3';
                                                        else if (p === 'S5') label = 'P4';
                                                        else if (p === 'S6') label = 'P5';
                                                        else if (p === 'S7') label = 'BRK';
                                                        else if (p === 'S8') label = 'P6';
                                                        else if (p === 'S9') label = 'P7/L';
                                                        else if (p === 'S10') label = 'L/P7';
                                                        else if (p === 'S11') label = 'P8';

                                                        return (
                                                            <th key={`${day}-${p}`} style={{
                                                                background: '#0f172a', color: '#475569',
                                                                fontSize: '0.6rem', fontWeight: 700,
                                                                padding: '0.3rem 0', textAlign: 'center',
                                                                borderLeft: pi === 0 ? '2px solid #334155' : '1px solid #1e293b',
                                                                borderBottom: '2px solid #334155',
                                                                width: '42px', minWidth: '42px'
                                                            }}>
                                                                {label}
                                                            </th>
                                                        );
                                                    })
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rowItems.map((item, ti) => {
                                                const details = getBusyDetails(item, dptViewType);
                                                return (
                                                    <tr key={item} style={{ borderBottom: '1px solid #1e293b' }}>
                                                        {/* Item name — sticky */}
                                                        <td style={{
                                                            position: 'sticky', left: 0, zIndex: 2,
                                                            background: ti % 2 === 0 ? '#111827' : '#0f172a',
                                                            color: '#f1f5f9', fontSize: '0.72rem', fontWeight: 700,
                                                            padding: '0.5rem 1rem', borderRight: '2px solid #334155',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {item}
                                                            {dptViewType === 'Teachers' && teacherSubjectMap[item.trim()] && (
                                                                <div style={{ fontSize: '0.62rem', color: '#64748b', marginTop: '2px', fontWeight: 600, letterSpacing: '0.01em' }}>
                                                                    {teacherSubjectMap[item.trim()]}
                                                                </div>
                                                            )}
                                                        </td>
                                                        {/* Busy count */}
                                                        <td style={{
                                                            background: ti % 2 === 0 ? '#111827' : '#0f172a',
                                                            color: '#94a3b8', fontSize: '0.75rem', fontWeight: 900,
                                                            textAlign: 'center', borderRight: '1px solid #334155'
                                                        }}>
                                                            {details.total > 0 ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                                    <span style={{ color: '#fff' }}>{details.total}</span>
                                                                    {details.stream > 0 && (
                                                                        <span style={{ fontSize: '0.6rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '1px 4px', borderRadius: '4px' }}>
                                                                            incl. {details.stream} [S]
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : '—'}
                                                        </td>
                                                        {/* Period cells */}
                                                        {DPT_DAYS.map((day, di) => (
                                                            DPT_PERIODS.map((p, pi) => {
                                                                let isMiddle;
                                                                if (dptViewType === 'Teachers') {
                                                                    const teacherMapping = mappingRows.find(m => m.teacher === item);
                                                                    const firstAllotmentCls = teacherMapping?.allotments?.[0]?.classes?.[0] || '';
                                                                    isMiddle = (teacherMapping?.level || '').includes('Middle') || (parseInt(firstAllotmentCls) < 11);
                                                                } else {
                                                                    // For classes, check grade level
                                                                    const grade = item.match(/\d+/)?.[0];
                                                                    isMiddle = (grade && parseInt(grade) < 11);
                                                                }

                                                                const isCT = p === 'CT';
                                                                const isBreak = p === 'S3' || p === 'S7';
                                                                const isLunch = isMiddle ? p === 'S9' : p === 'S10';

                                                                const eng = dptViewType === 'Teachers' ? getTeacherEngagement(item, day, p) : getClassEngagement(item, day, p);
                                                                const content = isCT ? 'CT' : (isBreak ? 'BREAK' : (isLunch ? 'LUNCH' : (eng || '')));
                                                                const isReserved = isCT || isBreak || isLunch;

                                                                return (
                                                                    <td key={`${day}-${p}`} title={getTooltip(item, day, p, dptViewType)}
                                                                        style={{
                                                                            ...cellBase,
                                                                            borderLeft: pi === 0 ? '2px solid #334155' : '1px solid #1e293b',
                                                                            background: eng ? 'rgba(79,70,229,0.22)' : (isCT ? 'rgba(129,140,248,0.03)' : (isBreak ? 'rgba(251,191,36,0.03)' : (isLunch ? 'rgba(56,189,248,0.03)' : '#0f172a'))),
                                                                            color: eng ? '#a5b4fc' : (isCT ? 'rgba(129,140,248,0.2)' : (isBreak ? 'rgba(251,191,36,0.2)' : (isLunch ? 'rgba(56,189,248,0.2)' : '#1e293b'))),
                                                                            fontSize: isReserved ? '0.5rem' : '0.62rem',
                                                                            opacity: isReserved ? 0.6 : 1,
                                                                            position: 'relative'
                                                                        }}
                                                                    >
                                                                        {content}
                                                                    </td>
                                                                );
                                                            })
                                                        ))}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Summary footer */}
                                <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#475569', textAlign: 'right' }}>
                                    {rowItems.length} {dptViewType} · {DPT_DAYS.length} days · {DPT_PERIODS.length} periods/day
                                </div>
                            </div>
                        );
                    })()
                }

                {/* Tab 5: TeacherTT (Teacher Timetables) */}
                {
                    activeTab === 5 && (() => {
                        const teacherTTDict = generatedTimetable?.teacherTimetables || {};

                        // Comprehensive teacher discovery: include from TT, mappings, and allotments
                        // 1. Discovery & Normalization
                        // 1. Discovery
                        const allTeacherNames = new Set();
                        Object.keys(teacherTTDict).forEach(t => { if (t && t !== 'EMPTY TEMPLATE') allTeacherNames.add(t.trim()); });
                        mappingRows.forEach(r => { if (r.teacher && r.teacher !== 'EMPTY TEMPLATE') allTeacherNames.add(r.teacher.trim()); });
                        allotmentRows.forEach(r => { if (r.teacher && r.teacher !== 'EMPTY TEMPLATE') allTeacherNames.add(r.teacher.trim()); });

                        const middleTeachers = [];
                        const seniorTeachers = [];

                        Array.from(allTeacherNames).forEach(tName => {
                            const trimmedT = tName.trim();
                            const mapping = mappingRows.find(m => (m.teacher || '').trim() === trimmedT);
                            if (mapping) {
                                // Explicit check: if it contains 'Middle' and not 'Senior' or 'Main', put in Middle
                                // Otherwise, if it has Main or Senior, put in Senior.
                                const level = mapping.level || '';
                                if (level === 'Middle') {
                                    middleTeachers.push(trimmedT);
                                } else {
                                    seniorTeachers.push(trimmedT);
                                }
                            } else {
                                // Fallback: try to guess level from allotments
                                const teacherAllotments = allotmentRows.find(r => (r.teacher || '').trim() === trimmedT);
                                if (teacherAllotments && teacherAllotments.allotments?.length > 0) {
                                    const firstClass = teacherAllotments.allotments[0].classes[0];
                                    const grade = parseInt(firstClass) || 0;
                                    // Senior school according to print layout starts at 9
                                    if (grade >= 1 && grade <= 8) {
                                        middleTeachers.push(trimmedT);
                                    } else {
                                        seniorTeachers.push(trimmedT);
                                    }
                                } else {
                                    seniorTeachers.push(trimmedT); // Default to Senior if no info
                                }
                            }
                        });

                        const uniqueMiddle = [...new Set(middleTeachers)].sort((a, b) => a.localeCompare(b));
                        const uniqueSenior = [...new Set(seniorTeachers)].sort((a, b) => a.localeCompare(b));

                        const categoryTeachers = teacherTTSubTab === 'Middle' ? uniqueMiddle : uniqueSenior;

                        const emptyTeachers = Array.from(allTeacherNames).filter(name => {
                            const trimmedName = name.trim();
                            const hasAssignments = teacherTTDict[trimmedName] && Object.values(teacherTTDict[trimmedName]).some(day => Object.values(day).some(p => p && typeof p === 'object' && p.subject));
                            const totalAllotmentPeriods = allotmentRows.filter(r => (r.teacher || '').trim() === trimmedName).reduce((sum, r) => sum + (r.total || 0), 0);
                            return !hasAssignments && totalAllotmentPeriods === 0;
                        });

                        // Chunk teachers into groups of 4 for 2x2 grid pages
                        const PAGE_SIZE = 4;
                        const totalPages = Math.max(1, Math.ceil(categoryTeachers.length / PAGE_SIZE));
                        const currentPageTeachers = categoryTeachers.slice((teacherTTPage - 1) * PAGE_SIZE, teacherTTPage * PAGE_SIZE);

                        // Fill remaining slots to ALWAYS show 4 templates
                        const pageList = [...currentPageTeachers];
                        while (pageList.length < PAGE_SIZE) {
                            pageList.push(null);
                        }



                        const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        const PERIODS = ['CT', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'];

                        // Subject Abbreviation Mapping
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
                            // Handle cases like "10E/10F", "9A, 9B", or "12A,12B,12C"
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
                                if (consistent && commonNum) {
                                    return { num: commonNum, div: allDivs };
                                }
                            }
                            // Single class like "10E"
                            const singleMatch = className.match(/^(\d+)([A-Z])$/);
                            if (singleMatch) {
                                return { num: singleMatch[1], div: singleMatch[2] };
                            }
                            return { num: className, div: '' };
                        };

                        const handlePrintAll = () => {
                            if (!generatedTimetable) return;
                            const cards = categoryTeachers.map(t => generateTeacherTimetableHTML(
                                generatedTimetable.teacherTimetables,
                                t,
                                '2026-2027',
                                generatedTimetable.bellTimings,
                                teacherTTSubTab === 'Middle'
                            ));
                            const html = generateFullPrintHTML(cards, 'teacher', '2026-2027', generatedTimetable.bellTimings);
                            const win = window.open('', '_blank');
                            win.document.write(html);
                            win.document.close();
                        };

                        // Inner component to render a single teacher's TT
                        const TeacherCard = ({ teacher }) => {
                            const trimmedName = (teacher || '').trim();
                            const teacherMapping = mappingRows.find(m => (m.teacher || '').trim() === trimmedName);
                            // Support lookup for both trimmed and potentially untrimmed keys in existing state
                            const tTT = teacherTTDict[trimmedName] || (teacher && teacherTTDict[teacher]);

                            // Use sub-tab as primary indicator
                            let isMiddle = teacherTTSubTab === 'Middle';

                            // Discover subjects for this teacher
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
                                                            if (di !== 0) return null; // Only render for first row with rowSpan
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

                                                        const slot = tTT?.[day]?.[p];
                                                        const isObj = slot && typeof slot === 'object';
                                                        let displayClass = isObj ? slot.className : (slot || '-');
                                                        let displaySub = isObj ? (slot.subject || '') : '';

                                                        // Extract Lab/Theory indicator
                                                        let labType = '';
                                                        if (isObj && slot.labGroup && slot.labGroup !== 'None') {
                                                            labType = slot.isLabPeriod ? '(L)' : '(T)';
                                                        }

                                                        displaySub = getSubAbbr(displaySub);

                                                        const { num, div } = getFormattedClass(displayClass);
                                                        const typeIndicator = slot?.isTBlock ? 'T' : (slot?.isLBlock ? 'L' : '');
                                                        const indicatorSpan = typeIndicator ? <sub style={{ fontSize: '0.55rem', verticalAlign: 'super', fontWeight: 500, marginLeft: '1px' }}>{typeIndicator}</sub> : null;
                                                        const isCombined = div && div.length <= 3;

                                                        return (
                                                            <td key={p} style={{
                                                                border: '1px solid black',
                                                                textAlign: 'center',
                                                                height: '42px',
                                                                background: isLunch ? '#fff1f2' : 'white',
                                                                padding: '1px',
                                                                color: 'black',
                                                                verticalAlign: 'middle'
                                                            }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0px' }}>
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
                                {/* Sub-tab Headers */}
                                <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem', background: '#1e293b', padding: '0.8rem', borderRadius: '1rem', border: '1px solid #334155' }}>
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

                                {/* Header with Page Controls & Print Button */}
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
                                                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                                                ))}
                                            </select>
                                            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>OF {totalPages}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                disabled={teacherTTPage === 1}
                                                onClick={() => setTeacherTTPage(p => p - 1)}
                                                style={{ padding: '0.4rem 0.8rem', background: '#334155', color: 'white', border: 'none', borderRadius: '0.4rem', cursor: teacherTTPage === 1 ? 'not-allowed' : 'pointer', opacity: teacherTTPage === 1 ? 0.5 : 1, fontWeight: '700' }}
                                            >Prev</button>
                                            <button
                                                disabled={teacherTTPage === totalPages}
                                                onClick={() => setTeacherTTPage(p => p + 1)}
                                                style={{ padding: '0.4rem 0.8rem', background: '#334155', color: 'white', border: 'none', borderRadius: '0.4rem', cursor: teacherTTPage === totalPages ? 'not-allowed' : 'pointer', opacity: teacherTTPage === totalPages ? 0.5 : 1, fontWeight: '700' }}
                                            >Next</button>
                                        </div>
                                        <span style={{ width: '1px', height: '1rem', background: '#334155' }} />
                                        <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{categoryTeachers.length} teachers found</span>
                                        {emptyTeachers.length > 0 && (
                                            <button
                                                onClick={removeEmptyTeachers}
                                                style={{ marginLeft: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '0.5rem 1rem', borderRadius: '0.6rem', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', transition: 'all 0.2s' }}
                                                onMouseOver={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                                                onMouseOut={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                                            >
                                                🗑️ Remove {emptyTeachers.length} Empty
                                            </button>
                                        )}
                                    </div>
                                    <button
                                        onClick={handlePrintAll}
                                        style={{
                                            padding: '0.7rem 1.5rem',
                                            background: '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            cursor: 'pointer',
                                            fontWeight: '800',
                                            fontSize: '0.9rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)'
                                        }}
                                    >
                                        <span>🖨️</span> Print All {teacherTTSubTab} Timetables
                                    </button>
                                </div>

                                {/* A4 Landscape Page Simulation (2x2 Grid) */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, 1fr)',
                                    gridTemplateRows: 'repeat(2, 1fr)',
                                    gap: '20px',
                                    background: 'white',
                                    padding: '20px',
                                    borderRadius: '0',
                                    minHeight: '850px',
                                    border: '1px solid black',
                                    position: 'relative'
                                }}>
                                    {pageList.map((teacher, idx) => (
                                        <TeacherCard key={teacher || `blank-${idx}`} teacher={teacher} />
                                    ))}
                                    <div style={{ position: 'absolute', bottom: '5px', right: '10px', fontSize: '10px', color: 'black', fontStyle: 'italic', opacity: 0.5 }}>
                                        jkrdomain — Page {teacherTTPage}/{totalPages}
                                    </div>
                                </div>
                            </div>
                        );
                    })()
                }

                {/* Tab 6: Generate */}
                {
                    activeTab === 6 && (
                        <div style={{ animation: 'fadeIn 0.3s ease-out', padding: '2rem 0' }}>
                            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                                <button
                                    onClick={() => {
                                        localStorage.setItem('tt_bell_timings', JSON.stringify(bellTimings));
                                        localStorage.setItem('tt_generated_timetable', JSON.stringify(generatedTimetable));
                                        addToast('Saved', 'success');
                                    }}
                                    style={{
                                        padding: '0.75rem 1.5rem',
                                        background: '#10b981',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        marginBottom: '1.5rem'
                                    }}
                                >
                                    💾 Save
                                </button>
                                {/* Bell Timings Configuration */}
                                <div style={{ marginBottom: '3rem' }}>
                                    <h3 style={{ fontSize: '1.8rem', fontWeight: '900', color: '#f1f5f9', marginBottom: '1.5rem', textAlign: 'left' }}>
                                        ⏰ Bell Timings Configuration
                                    </h3>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        {/* Middle School Card */}
                                        <div style={{
                                            background: '#1e293b',
                                            borderRadius: '1rem',
                                            padding: '1.5rem',
                                            border: '1px solid #334155',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                        }}>
                                            <h4 style={{ color: '#06b6d4', fontSize: '1.1rem', fontWeight: '800', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                🏫 Middle School (Grades 6,7,8)
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                {Object.entries(bellTimings.middleSchool).map(([period, time]) => (
                                                    <div key={period} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                        <span style={{ width: '90px', color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700' }}>{period}:</span>
                                                        <input
                                                            type="text"
                                                            value={time}
                                                            onChange={(e) => setBellTimings({
                                                                ...bellTimings,
                                                                middleSchool: { ...bellTimings.middleSchool, [period]: e.target.value }
                                                            })}
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#0f172a',
                                                                border: '1px solid #334155',
                                                                borderRadius: '0.5rem',
                                                                color: '#f1f5f9',
                                                                fontSize: '0.9rem',
                                                                fontFamily: 'monospace'
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Senior School Card */}
                                        <div style={{
                                            background: '#1e293b',
                                            borderRadius: '1rem',
                                            padding: '1.5rem',
                                            border: '1px solid #334155',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                        }}>
                                            <h4 style={{ color: '#d97706', fontSize: '1.1rem', fontWeight: '800', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                🏛️ Senior School (Grades 9,10,11,12)
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                {Object.entries(bellTimings.seniorSchool).map(([period, time]) => (
                                                    <div key={period} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                        <span style={{ width: '90px', color: '#94a3b8', fontSize: '0.85rem', fontWeight: '700' }}>{period}:</span>
                                                        <input
                                                            type="text"
                                                            value={time}
                                                            onChange={(e) => setBellTimings({
                                                                ...bellTimings,
                                                                seniorSchool: { ...bellTimings.seniorSchool, [period]: e.target.value }
                                                            })}
                                                            style={{
                                                                flex: 1,
                                                                padding: '0.5rem 0.8rem',
                                                                background: '#0f172a',
                                                                border: '1px solid #334155',
                                                                borderRadius: '0.5rem',
                                                                color: '#f1f5f9',
                                                                fontSize: '0.9rem',
                                                                fontFamily: 'monospace'
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div style={{
                                    background: '#0f172a',
                                    padding: '3rem',
                                    borderRadius: '1.5rem',
                                    maxWidth: '600px',
                                    margin: '0 auto',
                                    border: '1px solid #334155'
                                }}>
                                    <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🤖</div>
                                    <h3 style={{ fontSize: '2rem', fontWeight: '900', color: '#f1f5f9', marginBottom: '1rem' }}>Generate Timetable</h3>
                                    <p style={{ color: '#94a3b8', fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '2.5rem' }}>
                                        Ready to generate a conflict-free expert timetable? Our AI algorithm will process your teacher mappings and class distribution to create the perfect schedule.
                                    </p>
                                    <button
                                        onClick={handleGenerateTimetable}
                                        disabled={isGenerating}
                                        style={{
                                            padding: '1rem 2rem',
                                            background: isGenerating ? '#64748b' : '#b91c1c',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1.2rem',
                                            fontWeight: '700',
                                            cursor: isGenerating ? 'not-allowed' : 'pointer',
                                            width: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.75rem',
                                            marginBottom: '2rem',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isGenerating) e.target.style.background = '#991b1b';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isGenerating) e.target.style.background = '#b91c1c';
                                        }}
                                    >
                                        {isGenerating ? (
                                            <>⚙️ GENERATING TIMETABLE... Please wait</>
                                        ) : (
                                            <>🚀 GENERATE MASTER TIMETABLE</>
                                        )}
                                    </button>
                                </div>

                                {/* Print Buttons */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '1rem',
                                    marginTop: '2rem'
                                }}>
                                    <button
                                        onClick={() => {
                                            if (!generatedTimetable) {
                                                addToast('Please generate timetable first', 'warning');
                                                return;
                                            }
                                            const teacherCards = Object.keys(generatedTimetable.teacherTimetables)
                                                .slice(0, 18) // First 18 teachers = 3 pages (6 per page)
                                                .map(teacherName =>
                                                    generateTeacherTimetableHTML(
                                                        generatedTimetable.teacherTimetables,
                                                        teacherName,
                                                        academicYear,
                                                        bellTimings
                                                    )
                                                );
                                            const printHTML = generateFullPrintHTML(teacherCards, 'teacher', academicYear, bellTimings);
                                            const printWindow = window.open('', '_blank');
                                            printWindow.document.write(printHTML);
                                            printWindow.document.close();
                                        }}
                                        disabled={!generatedTimetable}
                                        style={{
                                            padding: '1rem',
                                            background: generatedTimetable ? '#4f46e5' : '#64748b',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: generatedTimetable ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        🖨️ PRINT TEACHER TIMETABLES (6 per page)
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (!generatedTimetable) {
                                                addToast('Please generate timetable first', 'warning');
                                                return;
                                            }
                                            const classList = [
                                                '6A', '6B', '6C', '6D', '6E', '6F', '6G',
                                                '7A', '7B', '7C', '7D', '7E', '7F', '7G',
                                                '8A', '8B', '8C', '8D', '8E', '8F', '8G',
                                                '9A', '9B', '9C', '9D', '9E', '9F', '9G',
                                                '10A', '10B', '10C', '10D', '10E', '10F', '10G',
                                                '11A', '11B', '11C', '11D', '11E', '11F',
                                                '12A', '12B', '12C', '12D', '12E', '12F'
                                            ];
                                            const classCards = classList
                                                .filter(cn => generatedTimetable.classTimetables[cn])
                                                .map(className =>
                                                    generateClassTimetableHTML(
                                                        generatedTimetable.classTimetables,
                                                        className,
                                                        academicYear,
                                                        bellTimings
                                                    )
                                                );
                                            const printHTML = generateFullPrintHTML(classCards, 'class', academicYear, bellTimings);
                                            const printWindow = window.open('', '_blank');
                                            printWindow.document.write(printHTML);
                                            printWindow.document.close();
                                        }}
                                        disabled={!generatedTimetable}
                                        style={{
                                            padding: '1rem',
                                            background: generatedTimetable ? '#059669' : '#64748b',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.75rem',
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: generatedTimetable ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        🖨️ PRINT CLASS TIMETABLES (6 per page)
                                    </button>
                                </div>

                                {/* Footer Branding */}
                                <div style={{
                                    marginTop: '3rem',
                                    paddingTop: '1.5rem',
                                    borderTop: '1px solid #334155',
                                    textAlign: 'center',
                                    color: '#94a3b8',
                                    fontSize: '0.85rem'
                                }}>
                                    created by @jayankrtripunithura {new Date().getFullYear()} • Academic Year {academicYear}
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Tab 1, 2 Placeholders */}
                {
                    activeTab === 0 && (
                        <div style={{ textAlign: 'center', padding: '8rem 2rem', animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏗️</div>
                            <h3 style={{ color: '#f1f5f9', fontSize: '2rem', fontWeight: '900' }}>{tabs[activeTab].label}</h3>
                            <p style={{ color: '#94a3b8', fontSize: '1.2rem', marginTop: '1rem' }}>This component is currently under development.</p>
                        </div>
                    )
                }



            </div >

            {/* ─────────── Fixed bottom status ribbon ─────────── */}
            {
                creationStatus && (
                    <div style={{
                        position: 'fixed', bottom: 0, left: 0, right: 0,
                        zIndex: 1000,
                        background: creationStatus.isError ? '#1a0a0a' : '#0d1117',
                        borderTop: `3px solid ${creationStatus.isError ? '#ef4444' : '#3b82f6'}`,
                        boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
                        animation: 'slideUp 0.3s cubic-bezier(0.4,0,0.2,1)',
                        fontFamily: 'monospace',
                    }}>
                        {/* Top bar: teacher name + subject + dismiss */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.45rem 1rem 0.3rem',
                            borderBottom: '1px solid #1e293b',
                        }}>
                            <span style={{ fontSize: '1rem' }}>{creationStatus.isError ? '❌' : '⚙️'}</span>
                            <span style={{ fontWeight: 800, fontSize: '0.85rem', color: creationStatus.isError ? '#fca5a5' : '#93c5fd', letterSpacing: '0.04em', fontFamily: 'inherit' }}>
                                {creationStatus.isError ? 'ERROR' : (creationStatus.batchProgress ? creationStatus.batchProgress : 'BUILDING')}: {creationStatus.teacher}
                            </span>
                            <span style={{ color: '#475569', fontSize: '0.75rem', fontFamily: 'inherit' }}>· {creationStatus.subject}</span>
                            <div style={{ flex: 1 }} />
                            {/* Progress bar */}
                            {!creationStatus.isError && (
                                <div style={{ width: 120, height: 5, background: '#1e293b', borderRadius: 99, overflow: 'hidden', marginRight: '0.5rem' }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.min(100, (creationStatus.completedCount / 8) * 100)}%`,
                                        background: 'linear-gradient(90deg,#3b82f6,#06b6d4)',
                                        borderRadius: 99,
                                        transition: 'width 0.4s ease'
                                    }} />
                                </div>
                            )}
                            <button
                                onClick={() => setCreationStatus(null)}
                                title=""
                                style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.25rem' }}
                            >✕</button>
                        </div>

                        {/* Log lines — last 5, newest at bottom */}
                        <div
                            ref={el => { statusScrollRef.current = el; if (el) el.scrollTop = el.scrollHeight; }}
                            style={{
                                padding: '0.35rem 1rem 0.45rem',
                                maxHeight: 110,
                                overflowY: 'auto',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.15rem',
                            }}
                        >
                            {(creationStatus.messages || []).slice(-6).map((m, idx, arr) => {
                                const isSuccess = m.startsWith('✓') || m.startsWith('✅');
                                const isError = m.startsWith('✗') || m.startsWith('❌');
                                const isSep = m.startsWith('═');
                                return (
                                    <div key={idx} style={{
                                        fontSize: '0.78rem',
                                        lineHeight: 1.55,
                                        color: isSep ? '#334155' : isError ? '#fca5a5' : isSuccess ? '#86efac' : '#94a3b8',
                                        opacity: idx === arr.length - 1 ? 1 : 0.6,
                                        letterSpacing: '0.01em',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>{m}</div>
                                );
                            })}
                        </div>
                    </div>
                )
            }

            {/* Subject Stream Modal (Parallel Classes) */}
            {
                showStreamModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(2, 6, 23, 0.85)',
                        backdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2000,
                        animation: 'fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}>
                        <div style={{
                            background: '#1e293b',
                            borderRadius: '1.5rem',
                            width: '95%',
                            maxWidth: '850px',
                            maxHeight: '90vh',
                            overflow: 'hidden',
                            padding: '2.5rem',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
                            display: 'flex',
                            flexDirection: 'column',
                            position: 'relative'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                                <div>
                                    <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                                        {editingStreamId ? 'Edit Parallel Stream' : 'Create New Parallel Stream'}
                                    </h2>
                                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.25rem' }}>Configure subjects that run simultaneously for the same class</p>
                                </div>
                                <button
                                    onClick={() => setShowStreamModal(false)}
                                    style={{
                                        background: '#334155',
                                        border: 'none',
                                        color: '#94a3b8',
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => { e.target.style.background = '#475569'; e.target.style.color = '#f1f5f9'; }}
                                    onMouseLeave={(e) => { e.target.style.background = '#334155'; e.target.style.color = '#94a3b8'; }}
                                >✕</button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '1.25rem', marginBottom: '2.5rem', background: 'rgba(15, 23, 42, 0.3)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stream Identifier</label>
                                    <input
                                        type="text"
                                        value={streamForm.name}
                                        onChange={e => setStreamForm({ ...streamForm, name: e.target.value.toUpperCase() })}
                                        placeholder="e.g. 2ND LANGUAGE"
                                        style={{ width: '100%', padding: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem', color: 'white', fontSize: '0.95rem', fontWeight: 700 }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Abbreviation</label>
                                    <input
                                        type="text"
                                        value={streamForm.abbreviation}
                                        onChange={e => setStreamForm({ ...streamForm, abbreviation: e.target.value })}
                                        placeholder="e.g. 2ndLang"
                                        maxLength={8}
                                        style={{ width: '100%', padding: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem', color: '#10b981', fontSize: '0.95rem', fontWeight: 700 }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Class</label>
                                    <select
                                        value={streamForm.className}
                                        onChange={e => setStreamForm({ ...streamForm, className: e.target.value })}
                                        style={{ width: '100%', padding: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem', color: 'white', fontSize: '0.95rem', fontWeight: 700 }}
                                    >
                                        {CLASS_OPTIONS.map(c => <option key={c} value={c} style={{ color: '#000', background: '#fff' }}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Weekly Load</label>
                                    <select
                                        value={streamForm.periods}
                                        onChange={e => setStreamForm({ ...streamForm, periods: Number(e.target.value) })}
                                        style={{ width: '100%', padding: '0.85rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.75rem', color: 'white', fontSize: '0.95rem', fontWeight: 700 }}
                                    >
                                        {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n} style={{ color: '#000', background: '#fff' }}>{n} Periods</option>)}
                                    </select>
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '2rem', paddingRight: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                    <label style={{ color: '#818cf8', fontSize: '0.9rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Parallel Group Assignments</label>
                                    <button
                                        onClick={addSubjectToStream}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: 'rgba(79, 70, 229, 0.1)',
                                            border: '1px solid #4f46e5',
                                            borderRadius: '0.5rem',
                                            color: '#818cf8',
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            transition: 'all 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.4rem'
                                        }}
                                        onMouseEnter={(e) => { e.target.style.background = 'rgba(79, 70, 229, 0.2)'; }}
                                        onMouseLeave={(e) => { e.target.style.background = 'rgba(79, 70, 229, 0.1)'; }}
                                    ><span>＋</span> Add New Group</button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {streamForm.subjects.map((sub, idx) => (
                                        <div key={idx} style={{
                                            display: 'grid',
                                            gridTemplateColumns: '1.2fr 1fr 1fr 100px 60px 40px',
                                            gap: '0.6rem',
                                            alignItems: 'center',
                                            background: 'rgba(30, 41, 59, 0.5)',
                                            padding: '0.75rem',
                                            borderRadius: '0.85rem',
                                            border: '1px solid rgba(255, 255, 255, 0.03)'
                                        }}>
                                            <div>
                                                <select
                                                    value={sub.subject}
                                                    onChange={e => updateStreamSubject(idx, 'subject', e.target.value)}
                                                    style={{ width: '100%', padding: '0.65rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', color: 'white', fontSize: '0.85rem' }}
                                                >
                                                    <option value="" style={{ color: '#000', background: '#fff' }}>-- select subject --</option>
                                                    {[...subjects].sort().map(s => <option key={s} value={s} style={{ color: '#000', background: '#fff' }}>{s}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <select
                                                    value={sub.teacher}
                                                    onChange={e => updateStreamSubject(idx, 'teacher', e.target.value)}
                                                    style={{ width: '100%', padding: '0.65rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', color: 'white', fontSize: '0.85rem' }}
                                                >
                                                    <option value="" style={{ color: '#000', background: '#fff' }}>-- select teacher --</option>
                                                    {teachers.filter(t => {
                                                        if (!sub.subject) return true;
                                                        const trimmedT = (t || '').trim();
                                                        const targetSub = sub.subject.trim().toUpperCase();
                                                        return mappingRows.some(m =>
                                                            (m.teacher || '').trim() === trimmedT &&
                                                            (m.subjects || []).some(s => s.trim().toUpperCase() === targetSub)
                                                        );
                                                    }).sort().map(t => <option key={t} value={t} style={{ color: '#000', background: '#fff' }}>{t}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <input
                                                    type="text"
                                                    value={sub.groupName}
                                                    onChange={e => updateStreamSubject(idx, 'groupName', e.target.value)}
                                                    placeholder="Group Name (e.g. Hindi)"
                                                    style={{ width: '100%', padding: '0.65rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', color: 'white', fontSize: '0.85rem' }}
                                                />
                                            </div>
                                            <div>
                                                <select
                                                    value={sub.labGroup || 'None'}
                                                    onChange={e => updateStreamSubject(idx, 'labGroup', e.target.value)}
                                                    style={{ width: '100%', padding: '0.65rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', color: '#10b981', fontSize: '0.8rem', fontWeight: 800 }}
                                                >
                                                    <option value="None">No Lab</option>
                                                    <option value="CSc Lab Group">CSc Group</option>
                                                    <option value="DS/AI Lab Group">DS/AI Group</option>
                                                </select>
                                            </div>
                                            <div>
                                                <input
                                                    type="number"
                                                    value={sub.targetLabCount || 0}
                                                    onChange={e => updateStreamSubject(idx, 'targetLabCount', Number(e.target.value))}
                                                    title="Lab Periods (LP)"
                                                    min="0"
                                                    max={streamForm.periods}
                                                    style={{ width: '100%', padding: '0.65rem', background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', color: '#10b981', fontSize: '0.85rem', fontWeight: 900, textAlign: 'center' }}
                                                />
                                            </div>
                                            <button
                                                onClick={() => removeSubjectFromStream(idx)}
                                                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem' }}
                                                onMouseEnter={(e) => { e.target.style.color = '#ef4444'; }}
                                                onMouseLeave={(e) => { e.target.style.color = '#94a3b8'; }}
                                            >✕</button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', borderTop: '1px solid #334155', paddingTop: '1.75rem', marginTop: 'auto' }}>
                                <button
                                    onClick={() => setShowStreamModal(false)}
                                    style={{ padding: '0.85rem 1.75rem', background: 'transparent', border: '1px solid #475569', borderRadius: '0.85rem', color: '#94a3b8', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s' }}
                                    onMouseEnter={(e) => { e.target.style.color = '#f1f5f9'; e.target.style.borderColor = '#94a3b8'; }}
                                    onMouseLeave={(e) => { e.target.style.color = '#94a3b8'; e.target.style.borderColor = '#475569'; }}
                                >Cancel</button>
                                <button
                                    onClick={async () => {
                                        const savedStream = handleSaveStream();
                                        if (savedStream) {
                                            // Automatically trigger placement (deployment) into the timetable
                                            await handleCreateStreamSpecific(savedStream);
                                        }
                                    }}
                                    style={{
                                        padding: '0.85rem 2rem',
                                        background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
                                        border: 'none',
                                        borderRadius: '0.85rem',
                                        color: 'white',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(79, 70, 229, 0.4)',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 6px 15px rgba(79, 70, 229, 0.5)'; }}
                                    onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.4)'; }}
                                >
                                    {editingStreamId ? 'Update Stream' : 'Stream Deploy'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Dropdown */}
            {
                dropdownConfig && (
                    <GradeDropdown
                        anchorRect={dropdownConfig.rect}
                        onClose={() => setDropdownConfig(null)}
                        onSelect={(grade) => handleSetGrade(dropdownConfig.mappingId, dropdownConfig.slotIndex, grade)}
                    />
                )
            }

            {/* Dropdown overlay */}
            {
                dropdownConfig && (
                    <div onClick={() => setDropdownConfig(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }}></div>
                )
            }

            <style>{`
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes slideUp {
                    from { transform: translateY(100%); opacity: 0; }
                    to   { transform: translateY(0);    opacity: 1; }
                }
                body {
                    margin: 0;
                    padding: 0;
                    background: #0f172a;
                }
                * {
                    box-sizing: border-box;
                }
                .tt-cell-changed {
                    animation: pulseOrange 2s infinite;
                    position: relative;
                    border: 1px solid #f97316 !important;
                    background: rgba(249, 115, 22, 0.1) !important;
                }
                .tt-change-badge {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 8px;
                    height: 8px;
                    background: #f97316;
                    border-radius: 50%;
                    box-shadow: 0 0 4px rgba(0,0,0,0.3);
                }
                .tt-tooltip {
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #0f172a;
                    color: white;
                    padding: 0.5rem 0.75rem;
                    border-radius: 0.5rem;
                    font-size: 0.75rem;
                    white-space: nowrap;
                    z-index: 100;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s;
                    border: 1px solid #334155;
                    pointer-events: none;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    margin-bottom: 8px;
                }
                .tt-cell-parent:hover .tt-tooltip {
                    opacity: 1;
                    visibility: visible;
                    transform: translateX(-50%) translateY(-4px);
                }
            `}</style>
            <footer style={{ marginTop: '3rem', textAlign: 'center', opacity: 0.5, fontSize: '0.9rem', color: '#94a3b8', fontWeight: '600' }}>
                created by @jayankrtripunithura 2026
            </footer>
        </div >
    );
}
