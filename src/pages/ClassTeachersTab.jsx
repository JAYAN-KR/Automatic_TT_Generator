import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import '../styles/classTeachers.css';

const CLASSROOMS = [
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
    '7A', '7B', '7C', '7D', '7E', '7F', '7G',
    '8A', '8B', '8C', '8D', '8E', '8F', '8G',
    '9A', '9B', '9C', '9D', '9E', '9F', '9G',
    '10A', '10B', '10C', '10D', '10E', '10F', '10G',
    '11A', '11B', '11C', '11D', '11E', '11F', '11G',
    '12A', '12B', '12C', '12D', '12E', '12F', '12G'
];

export default function ClassTeachersTab({ teachers = [] }) {
    const [classTeachers, setClassTeachers] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    // Initialize classTeachers from localStorage or Firebase on mount
    useEffect(() => {
        const loadClassTeachers = async () => {
            try {
                // Try localStorage first
                const localData = localStorage.getItem('classTeachers_data');
                if (localData) {
                    const parsed = JSON.parse(localData);
                    setClassTeachers(parsed);
                    return;
                }

                // Try Firebase
                const docRef = doc(db, 'classTeachers', 'mappings');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setClassTeachers(docSnap.data().data || []);
                    return;
                }

                // Initialize with empty data
                const emptyData = CLASSROOMS.map(className => ({
                    className,
                    classTeacher: '',
                    associateTeacher: ''
                }));
                setClassTeachers(emptyData);
            } catch (error) {
                console.error('Error loading class teachers:', error);
                // Initialize with empty data if error
                const emptyData = CLASSROOMS.map(className => ({
                    className,
                    classTeacher: '',
                    associateTeacher: ''
                }));
                setClassTeachers(emptyData);
            }
        };

        loadClassTeachers();
    }, []);

    const handleTeacherChange = (className, field, value) => {
        setClassTeachers(prev =>
            prev.map(item =>
                item.className === className
                    ? { ...item, [field]: value }
                    : item
            )
        );
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Save to localStorage
            localStorage.setItem('classTeachers_data', JSON.stringify(classTeachers));

            // Save to Firebase
            const docRef = doc(db, 'classTeachers', 'mappings');
            await setDoc(docRef, {
                data: classTeachers,
                updatedAt: new Date().toISOString()
            });

            setSaveMessage('✅ Class Teachers data saved successfully!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (error) {
            console.error('Error saving class teachers:', error);
            setSaveMessage('❌ Error saving data: ' + error.message);
            setTimeout(() => setSaveMessage(''), 3000);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="class-teachers-container">
            {/* Header with Save Button */}
            <div className="class-teachers-header">
                <h2>👨‍🏫 Class Teachers Mapping</h2>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="save-button"
                >
                    {isSaving ? '💾 Saving...' : '💾 Save Changes'}
                </button>
            </div>

            {/* Save Message */}
            {saveMessage && (
                <div className={`save-message ${saveMessage.includes('✅') ? 'success' : 'error'}`}>
                    {saveMessage}
                </div>
            )}

            {/* Table */}
            <div className="table-wrapper">
                <table className="class-teachers-table">
                    <thead>
                        <tr>
                            <th>Class</th>
                            <th>Class Teacher</th>
                            <th>Associate Teacher</th>
                        </tr>
                    </thead>
                    <tbody>
                        {classTeachers.map((item, idx) => (
                            <tr key={item.className} className={idx % 2 === 0 ? 'even' : 'odd'}>
                                <td className="class-name">{item.className}</td>
                                <td>
                                    <select
                                        value={item.classTeacher}
                                        onChange={(e) =>
                                            handleTeacherChange(item.className, 'classTeacher', e.target.value)
                                        }
                                        className="teacher-dropdown"
                                    >
                                        <option value="">-- Select Teacher --</option>
                                        {teachers.map((teacher) => (
                                            <option key={teacher} value={teacher}>
                                                {teacher}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                                <td>
                                    <select
                                        value={item.associateTeacher}
                                        onChange={(e) =>
                                            handleTeacherChange(item.className, 'associateTeacher', e.target.value)
                                        }
                                        className="teacher-dropdown"
                                    >
                                        <option value="">-- Select Teacher --</option>
                                        {teachers.map((teacher) => (
                                            <option key={teacher} value={teacher}>
                                                {teacher}
                                            </option>
                                        ))}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="class-teachers-footer">
                <p>Total Classes: {CLASSROOMS.length}</p>
                <p>Classes Assigned: {classTeachers.filter(c => c.classTeacher).length}</p>
            </div>
        </div>
    );
}
