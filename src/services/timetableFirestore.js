import { rtdb } from './firebase';
import { ref, push, set, get, update, query, orderByChild, equalTo, limitToLast, getDatabase } from 'firebase/database';
import { getMessaging, getToken } from 'firebase/messaging'; // For push notifications

const MAPPINGS_PATH = 'timetableMappings';
const VERSIONS_PATH = 'timetableVersions';

/**
 * Updates a version's status to 'active'.
 */
export const publishTimetableVersion = async (versionId) => {
    try {
        const versionRef = ref(rtdb, `${VERSIONS_PATH}/${versionId}/status`);
        await set(versionRef, 'active');
        return { success: true };
    } catch (error) {
        console.error('Error publishing version:', error);
        throw error;
    }
};

/**
 * Loads the latest mappings for a specific academic year.
 */
export const loadTimetableMappings = async (academicYear) => {
    try {
        // 1. Find versions for this academic year
        const versionsRef = ref(rtdb, VERSIONS_PATH);
        const versionsSnap = await get(versionsRef);

        if (!versionsSnap.exists()) {
            return { mappings: [], version: null };
        }

        // Find latest version for this academic year
        const allVersions = versionsSnap.val();
        let latestVersion = null;
        let latestVersionId = null;

        Object.entries(allVersions).forEach(([id, data]) => {
            if (data.academicYear === academicYear) {
                if (!latestVersion || data.createdAt > latestVersion.createdAt) {
                    latestVersion = data;
                    latestVersionId = id;
                }
            }
        });

        if (!latestVersion) {
            return { mappings: [], version: null };
        }

        const versionData = { id: latestVersionId, ...latestVersion };

        // 2. Load all mappings for this version
        const mappingsRef = ref(rtdb, MAPPINGS_PATH);
        const mappingsSnap = await get(mappingsRef);

        if (!mappingsSnap.exists()) {
            return { mappings: [], version: versionData };
        }

        const allMappings = mappingsSnap.val();
        const mappings = Object.entries(allMappings)
            .filter(([_, data]) => data.versionId === latestVersionId)
            .map(([id, data]) => ({
                id,
                teacher: data.teacherName,
                subject: data.subjectName,
                classes: data.assignedClasses || []
            }));

        return { mappings, version: versionData };
    } catch (error) {
        console.error('Error loading mappings:', error);
        throw error;
    }
};

/**
 * Saves all teacher-subject mappings to Realtime Database.
 */
export const saveTimetableMappings = async (mappings, academicYear, createdBy) => {
    try {
        console.log('[RTDB] saveTimetableMappings requested', { count: mappings.length, academicYear, createdBy });

        const now = new Date().toISOString();

        // 1. Create a new version record
        console.log('[RTDB] Step 1: Creating version record...');
        const versionRef = push(ref(rtdb, VERSIONS_PATH));
        await set(versionRef, {
            academicYear,
            version: `V${Date.now()}`,
            status: 'draft',
            createdAt: now,
            createdBy,
            mappingCount: mappings.length
        });
        console.log(`[RTDB] Version created: ${versionRef.key}`);

        // 2. Save all mappings
        console.log(`[RTDB] Step 2: Writing ${mappings.length} mappings...`);
        const mappingsData = {};
        mappings.forEach((mapping, index) => {
            const key = push(ref(rtdb, MAPPINGS_PATH)).key;
            mappingsData[`${MAPPINGS_PATH}/${key}`] = {
                teacherName: mapping.teacher || '',
                subjectName: mapping.subject || '',
                assignedClasses: mapping.classes || [],
                academicYear,
                versionId: versionRef.key,
                createdAt: now,
                createdBy,
                isActive: true
            };
        });

        // Write all mappings in a single multi-path update
        await update(ref(rtdb), mappingsData);
        console.log(`[RTDB] SUCCESS: All ${mappings.length} mappings saved for version ${versionRef.key}`);

        return { success: true, versionId: versionRef.key };
    } catch (error) {
        console.error('[RTDB] Save error:', error);
        throw error;
    }
};

// ============================================
// APK INTEGRATION - Realtime Database for Teachers
// ============================================

// ============================================
// APK INTEGRATION - Realtime Database for Teachers
// ============================================

export const publishTimetableToAPK = async (versionId, academicYear, classTimetables, teacherTimetables, bellTimings) => {
    console.log('📱 Publishing timetable to APK...', { academicYear, versionId });

    try {
        const db = getDatabase();
        const academicYearKey = academicYear.replace('-', '_');
        const basePath = `timetables/${academicYearKey}/active`;
        const timestamp = new Date().toISOString();

        // Format teacher timetables for APK
        const teacherData = {};
        if (teacherTimetables) {
            Object.keys(teacherTimetables).forEach(teacherName => {
                const teacherKey = teacherName.replace(/\s+/g, '_').replace(/\./g, '').toLowerCase();

                // Format each day's schedule
                const schedule = {};
                const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

                days.forEach(day => {
                    const daySchedule = teacherTimetables[teacherName][day] || {};
                    schedule[day.toLowerCase()] = {
                        ct: daySchedule.CT || '',
                        p1: daySchedule.P1 || '',
                        p2: daySchedule.P2 || '',
                        p3: daySchedule.P3 || '',
                        p4: daySchedule.P4 || '',
                        p5: daySchedule.P5 || '',
                        p6: daySchedule.P6 || '',
                        p7: daySchedule.P7 || '',
                        p8: daySchedule.P8 || ''
                    };
                });

                teacherData[teacherKey] = {
                    name: teacherName,
                    schedule: schedule,
                    weeklyPeriods: teacherTimetables[teacherName].weeklyPeriods || 0
                };
            });
        }

        // Format class timetables for APK
        const classData = {};
        if (classTimetables) {
            Object.keys(classTimetables).forEach(className => {
                const classKey = className.toLowerCase();

                const schedule = {};
                const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

                days.forEach(day => {
                    const daySchedule = classTimetables[className][day] || {};
                    schedule[day.toLowerCase()] = {
                        ct: daySchedule.CT?.subject || '',
                        p1: daySchedule.P1?.subject || '',
                        p2: daySchedule.P2?.subject || '',
                        p3: daySchedule.P3?.subject || '',
                        p4: daySchedule.P4?.subject || '',
                        p5: daySchedule.P5?.subject || '',
                        p6: daySchedule.P6?.subject || '',
                        p7: daySchedule.P7?.subject || '',
                        p8: daySchedule.P8?.subject || ''
                    };
                });

                classData[classKey] = {
                    name: className,
                    schedule: schedule
                };
            });
        }

        // Prepare APK data structure
        const apkData = {
            version: versionId,
            publishedAt: timestamp,
            academicYear: academicYear,
            metadata: {
                teacherCount: Object.keys(teacherData).length,
                classCount: Object.keys(classData).length,
                generatedAt: timestamp,
                status: 'active'
            },
            teachers: teacherData,
            classes: classData,
            bellTimings: bellTimings // Include bell timings for the app
        };

        // Write to Realtime DB
        console.log('💾 Writing to Firebase Realtime DB...');
        await set(ref(db, `${basePath}/data`), apkData);
        await set(ref(db, `${basePath}/metadata`), {
            versionId,
            academicYear,
            publishedAt: timestamp,
            teacherCount: Object.keys(teacherData).length,
            classCount: Object.keys(classData).length,
            status: 'active'
        });

        console.log('✅ Timetable published to APK successfully');

        // ===== PUSH NOTIFICATIONS =====
        // Get all teacher FCM tokens (you need to store these when teachers login)
        // This assumes you have a 'fcmTokens' node in your Realtime DB
        try {
            const tokensSnapshot = await get(ref(db, 'fcmTokens'));
            const tokens = tokensSnapshot.val() || {};

            const teacherTokens = Object.values(tokens).map(t => t.token).filter(Boolean);

            if (teacherTokens.length > 0) {
                console.log(`📨 Sending push notifications to ${teacherTokens.length} teachers...`);

                // You'll need Firebase Cloud Messaging setup for this
                // For now, we'll log that notifications would be sent
                console.log('🔔 Push notifications would be sent to all teachers');

                // In production with FCM configured:
                // await sendMulticast({
                //   tokens: teacherTokens,
                //   notification: {
                //     title: '📅 New Timetable Published',
                //     body: `Timetable for ${academicYear} is now available. Check your schedule!`,
                //   },
                //   data: {
                //     type: 'TIMETABLE_PUBLISHED',
                //     academicYear: academicYear,
                //     versionId: versionId,
                //     click_action: 'OPEN_TIMETABLE'
                //   }
                // });
            } else {
                console.log('No FCM tokens found for push notifications');
            }
        } catch (notifyError) {
            console.error('Push notification error (non-critical):', notifyError);
        }

        return {
            success: true,
            teacherCount: Object.keys(teacherData).length,
            classCount: Object.keys(classData).length
        };
    } catch (error) {
        console.error('❌ APK publish error:', error);
        throw error;
    }
};
