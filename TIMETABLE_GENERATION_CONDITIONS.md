# TIMETABLE GENERATION CONDITIONS - Complete Reference

**Version:** 1.0  
**Last Updated:** March 1, 2026  
**File Location:** `src/utils/timetableGenerator.js`

---

## TABLE OF CONTENTS

1. [Period Mapping Reference](#period-mapping-reference)
2. [Level & Building Configuration](#level--building-configuration)
3. [Daily Load Conditions](#daily-load-conditions)
4. [Subject Clustering Conditions](#subject-clustering-conditions)
5. [Teacher Availability Conditions](#teacher-availability-conditions)
6. [Class Availability Conditions](#class-availability-conditions)
7. [Lab Resource Conditions](#lab-resource-conditions)
8. [Preferred Day Conditions](#preferred-day-conditions)
9. [Task Priority & Sorting](#task-priority--sorting)
10. [Stream Conditions](#stream-conditions)
11. [Clubbed/Merged Class Conditions](#clubbedmerged-class-conditions)
12. [Placement Fallback](#placement-fallback)
13. [Weekly Period Tracking](#weekly-period-tracking)
14. [Swap/Chain Operation Conditions](#swapchain-operation-conditions)
15. [Validation & Verification](#validation--verification)
16. [Real-World Example](#real-world-example)
17. [Quick Reference Checklist](#quick-reference-checklist)

---

## PERIOD MAPPING REFERENCE

### Internal Code to User-Friendly Names

```
INTERNAL CODE → USER-FRIENDLY NAME → TIME SLOT

S1 → P1 (Period 1) → 8:35-9:15
S2 → P2 (Period 2) → 9:15-9:55
S3 → BRK-I (Break 1) → 9:55-10:10
S4 → P3 (Period 3) → 10:10-10:50
S5 → P4 (Period 4) → 10:50-11:30
S6 → P5 (Period 5) → 11:30-12:10
S7 → BRK-II (Break 2) → 12:10-12:20
S8 → P6 (Period 6) → 12:20-13:00
S9 → P7 (Period 7) → 13:00-13:30 (or Lunch in Middle School)
S10 → P7 (Period 7) → 13:30-14:05 (or Lunch in Senior School)
S11 → P8 (Period 8) → 14:05-14:55
CT → Homeroom → 8:00-8:35
```

### Days of Week

```
Monday, Tuesday, Wednesday, Thursday, Friday, Saturday
```

---

## LEVEL & BUILDING CONFIGURATION

### 1.1 Level Determination

```javascript
IF Grade >= 9
  THEN Level = 'Senior'
ELSE
  THEN Level = 'Middle'
```

**Example:**
- Class 6A, 7B, 8C → Middle School
- Class 9A, 10B, 11C, 12D → Senior School

### 1.2 Building Assignment

```javascript
IF Grade >= 11
  THEN Building = 'Senior'
ELSE
  THEN Building = 'Main'
```

**Example:**
- Class 6A, 7B, 8C, 9A, 10B → Main Building
- Class 11A, 11B, 12A, 12B → Senior Building

### 1.3 Available Periods by Level

```javascript
MIDDLE SCHOOL (Grades 6-8):
  Available Periods: CT, P1, P2, P3, P4, P5, P6, P7, P8
  Cannot assign to: BRK-I, BRK-II, LUNCH

SENIOR SCHOOL (Grades 9-12):
  Available Periods: CT, P1, P2, P3, P4, P5, P6, P7, P8
  Cannot assign to: BRK-I, BRK-II, LUNCH
```

**Key Difference:**
- Middle: P7 is teaching period, P9 is lunch
- Senior: P7 is teaching period, P10 is lunch

### 1.4 Valid Block Pairs by Level

```javascript
MIDDLE SCHOOL Block Pairs:
  [P1-P2], [P3-P4], [P4-P5], [P7-P8]

SENIOR SCHOOL Block Pairs:
  [P1-P2], [P3-P4], [P4-P5], [P6-P7]
```

**Rules:**
- Blocks must be consecutive periods
- Both periods must be available (not break/lunch)
- Teacher must be free for both periods
- Class must be free for both periods

---

## DAILY LOAD CONDITIONS

### 2.1 Maximum Periods per Day

```javascript
MAX_DAILY_LOAD = 6 periods per teacher per day

IF TeacherDailyLoad + RequiredPeriods > 6
  THEN Cannot place on this day
  ELSE Can place
```

### 2.2 Load Counting

```javascript
BLOCK period (e.g., P1-P2) = 2 periods used
SINGLE period (e.g., P3) = 1 period used
STREAM period = 1 period per teacher (multiple teachers possible)
```

### 2.3 Daily Load Examples

```
Day: Monday

Current Load: 0
Assign P1-P2 Block: Load becomes 2
Assign P3 Single: Load becomes 3
Assign P4 Single: Load becomes 4
Assign P5 Single: Load becomes 5
Assign P6 Single: Load becomes 6
Try to assign P7 Single: Would be 7 → REJECTED ✗
```

---

## SUBJECT CLUSTERING CONDITIONS

Clustering = Multiple periods of same subject on same day for teacher

### 3.1 Pass 1: Ideal Spread (HIGHEST PRIORITY)

```javascript
RULE: Each subject appears MAX ONCE per day for a teacher

IF Subject already assigned on this day for this teacher
  THEN Skip this day (try another day)

IF Period is BLOCK
  AND (TeacherLoad + 2) > 6
  THEN Cannot place on this day (exceeds daily limit)

IF Period is SINGLE
  AND Subject already on day
  THEN Skip this day
```

**Example:**
```
Monday: English (P1-P2 block = 2 periods used, load = 2)
Try to assign: English P3 (single)
  Pass 1: English already on Monday → SKIP → Try Tuesday
```

### 3.2 Pass 2: Relaxed Clustering (MEDIUM PRIORITY)

```javascript
RULE: Allow up to 2 units of same subject per day

FOR Single periods:
  IF (TeacherLoad >= 2) AND (Subject already on day)
    THEN Skip this day

IF (TeacherLoad + 1) > 6
  THEN Cannot place (exceeds daily limit)
```

**Example:**
```
Monday: Math (Single) = 1 period, load = 1
Try to add: Math (Single) = 1 period
  Pass 2: Load >= 2? NO → Can add
  Result: 2 Math units on Monday (clustering allowed) ✓
```

### 3.3 Pass 3: Final Fallback (LOWEST PRIORITY)

```javascript
RULE: Only check if daily load exceeds 6

IF (TeacherLoad + 1) > 6
  THEN Cannot place
ELSE
  THEN Accept placement
  (Ignore clustering and spread constraints)
```

---

## TEACHER AVAILABILITY CONDITIONS

### 4.1 Period Availability

```javascript
IF TeacherTimetable[teacher][day][period] == ''
  THEN Teacher is FREE
  
IF TeacherTimetable[teacher][day][period] != ''
  THEN Teacher is OCCUPIED
```

### 4.2 Building Constraint Violations

```javascript
CONSTRAINT: Teacher cannot move between buildings in consecutive periods

Consecutive Period Pairs (NO physical gap between):
  [P1-P2], [P3-P4], [P4-P5]

Transition Pair (LUNCH allows building change):
  [P6-P7] (Senior School only)

RULE:
  IF Teacher at period Pn in Building A
  AND Period Pn and Pn+1 are consecutive pair
  AND Period Pn+1 is in Building B (where B ≠ A)
  THEN VIOLATION → Cannot place
```

### 4.3 Building Constraint Violation Rules

```javascript
INVALID COMBINATIONS (VIOLATIONS):
  P1 (Main) + P2 (Senior) = INVALID ✗
  P3 (Main) + P4 (Senior) = INVALID ✗
  P4 (Senior) + P5 (Main) = INVALID ✗
  P6 (Main) + P7 (Senior) = INVALID ✗
  P7 (Senior) + P8 (Main) = INVALID ✗

VALID COMBINATIONS (ALLOWED):
  P1 (Main) + P3 (Senior) = VALID ✓
    Reason: BRK-I in between allows travel time
  
  P2 (Senior) + P4 (Main) = VALID ✓
    Reason: BRK-I in between
  
  P5 (Main) + P7 (Senior) = VALID ✓
    Reason: BRK-II in between
  
  P2 (Main) + P6 (Senior) = VALID ✓
    Reason: Lunch break in between allows travel
```

### 4.4 Specific Control Logic

```javascript
checkAdjacentBuildings(period1, period2):
  IF both are consecutive pairs listed above
    AND buildings differ
    RETURN conflict = true
  
isBuildingConstraintViolated(teacher, day, period, className):
  targetBuilding = getBuilding(className)
  
  IF period == P1: check adjacent P2
  IF period == P2: check adjacent P1 and P3
  IF period == P3: check adjacent P2 and P4
  ...etc
  
  IF any adjacent period has different building
    RETURN true (violation)
```

---

## CLASS AVAILABILITY CONDITIONS

### 5.1 Class Period Occupancy

```javascript
IF ClassTimetable[class][day][period].subject == ''
  THEN Class is FREE

IF ClassTimetable[class][day][period].subject != ''
  THEN Class is OCCUPIED
```

### 5.2 Reserved Periods

```javascript
RESERVED_PERIODS = ['BRK-I', 'BRK-II', 'LUNCH']

RULE: Cannot assign any subject to reserved periods

IF trying to assign to BRK-I
  THEN rejected = true
  
IF trying to assign to BRK-II
  THEN rejected = true
  
IF trying to assign to LUNCH
  THEN rejected = true
```

### 5.3 Level-Specific Reserved Periods

```javascript
MIDDLE SCHOOL (Grades 6-8):
  S3 = BRK-I (reserved)
  S7 = BRK-II (reserved)
  S9 = LUNCH (reserved)
  All other: Available

SENIOR SCHOOL (Grades 9-12):
  S3 = BRK-I (reserved)
  S7 = BRK-II (reserved)
  S10 = LUNCH (reserved)
  All other: Available
```

---

## LAB RESOURCE CONDITIONS

### 6.1 Lab Allocation by Subject & Grade

```javascript
COMPUTER LAB MAPPING:
  Subject: COMPUTER, CS, CSC, INFORMATICS PRACTICES, DATA SCIENCE, AI, ARTIFICIAL INTELLIGENCE
  
  Grade 1-8 → Middle School Computer Lab
  Grade 9-10 → Main School Computer Lab
  Grade 11-12 → Senior School Computer Lab

HOME SCIENCE LAB:
  Subject: HOME SCIENCE, HS, HSC
  Grade 9-12 → Main School Home Science Lab

SCIENCE LABS:
  Physics: Grade 9-12 → Physics Lab
  Chemistry: Grade 9-12 → Chemistry Lab
  Biology: Grade 9-12 → Biology Lab
```

### 6.2 Lab Conflict Detection

```javascript
RULE: No two classes can use SAME lab at SAME time
  (EXCEPT if both in same Lab Group)

FOR each class trying to place lab period:
  targetLab = getLabForSubject(className, subject)
  
  FOR each other class at [day][period]:
    IF other.isLabPeriod == true:
      otherLab = getLabForSubject(otherClass, otherSubject)
      
      IF targetLab == otherLab:
        IF labGroup == 'None' OR labGroup != other.labGroup:
          RETURN conflict = true (INVALID)
        ELSE:
          RETURN conflict = false (same group, allowed)
```

**Example Conflict:**
```
Class 9A, P3 Monday: Computer Science (Lab) → Uses Main Computer Lab
Class 9B, P3 Monday: Informatics Practices (Lab) → Uses Main Computer Lab
CONFLICT: Two classes, same lab, same time ✗

UNLESS:
Class 9A (Lab Group: A), Class 9B (Lab Group: A)
THEN: Both in Group A → Can share lab ✓
```

### 6.3 Lab Period Count Enforcement

```javascript
FOR each [Class + Subject] pair:
  targetLabCount = X (user-specified, default 3)
  
  Loop through all placed periods:
    IF period.isLabPeriod == true AND subject matches:
      labPeriodsAlreadyPlaced++
  
  DECISION:
    IF labPeriodsAlreadyPlaced < targetLabCount:
      THEN currentPeriod.isLabPeriod = true
    ELSE:
      THEN currentPeriod.isLabPeriod = false
```

**Example:**
```
Class 9A, Computer Science, Target: 3 lab periods/week

Period 1: P1 Monday → isLabPeriod = true (count: 1/3)
Period 2: P2 Monday → isLabPeriod = true (count: 2/3)
Period 3: P3 Tuesday → isLabPeriod = true (count: 3/3)
Period 4: P4 Tuesday → isLabPeriod = false (quota met, use theory)
Period 5: P5 Wednesday → isLabPeriod = false (quota met, use theory)
```

### 6.4 Lab Status Determination

```javascript
determineLabStatus(classData, taskData, day, period):
  
  Step 1: Check quota
    IF targetLabCount <= 0:
      RETURN false (always theory)
  
  Step 2: Check lab availability
    IF lab resource occupied by another class:
      RETURN false (cannot use lab)
  
  Step 3: Check quota consumption
    count = countExistingLabPeriods(className, subject)
    IF count < targetLabCount:
      RETURN true (mark as lab)
    ELSE:
      RETURN false (mark as theory)
```

---

## PREFERRED DAY CONDITIONS

### 7.1 Day Constraint

```javascript
IF preferredDay != 'Any' AND preferredDay != ''
  THEN candidateDays = [onlyPreferredDay]
  preferredDayEnforced = true
ELSE
  THEN candidateDays = [Mon, Tue, Wed, Thu, Fri, Sat]
  preferredDayEnforced = false
```

**Day Mapping:**
```
'Mon' → 'Monday'
'Tue' → 'Tuesday'
'Wed' → 'Wednesday'
'Thu' → 'Thursday'
'Fri' → 'Friday'
'Sat' → 'Saturday'
'Any' → all days
```

### 7.2 Day Randomization

```javascript
IF candidateDays.length > 1:
  dayStart = random(0, candidateDays.length - 1)
ELSE:
  dayStart = 0

LOOP through candidateDays starting from dayStart index:
  (wraps around using modulo)
```

---

## TASK PRIORITY & SORTING

### 8.1 Task Priority Levels

```javascript
Priority 1 (HIGHEST): Fixed Day Preference
  IF task.preferredDay != 'Any'
    priority = 1

Priority 2: Block Periods
  IF task.type == 'BLOCK'
    priority = 2

Priority 3: Stream Periods
  IF task.type == 'STREAM'
    priority = 3

Priority 4 (LOWEST): Single Periods
  IF task.type == 'SINGLE'
    priority = 4
```

### 8.2 Tie-Breaking for Same Priority

```javascript
IF priority[taskA] == priority[taskB]:
  gradeA = extractGrade(taskA.className)
  gradeB = extractGrade(taskB.className)
  
  SORT: gradeB - gradeA (DESCENDING)
  Result: Grade 12 before Grade 11 before Grade 10... before Grade 6
```

**Example Ordering:**
```
1. Fixed Day Block (Grade 12)
2. Fixed Day Block (Grade 11)
3. Fixed Day Block (Grade 10)
4. Block (Grade 12)
5. Block (Grade 11)
6. Block (Grade 10)
7. Stream (Grade 12)
8. Stream (Grade 11)
9. Single (Grade 12)
10. Single (Grade 11)
```

---

## STREAM CONDITIONS

### 9.1 Stream Definition

A stream is a parallel subject arrangement where multiple teachers teach different subjects to the SAME class in the SAME period.

**Example:**
```
Class 9A, Period P3 Monday:
  - Teacher 1: French
  - Teacher 2: Spanish
  - Teacher 3: Hindi

All three teachers teach at the SAME TIME to the SAME class
(Students choose one based on curriculum path)
```

### 9.2 Stream Placement Requirements

```javascript
FOR each stream period to place:
  
  1. Daily Load Check:
     FOR each teacher in stream.subjects:
       IF teacherLoad + 1 > 6:
         RETURN canPlace = false
  
  2. Teacher Availability:
     FOR each teacher in stream.subjects:
       IF teacherTimetable[teacher][day][period] != '':
         RETURN canPlace = false
  
  3. Building Constraint:
     FOR each teacher in stream.subjects:
       IF isBuildingConstraintViolated(teacher, day, period, className):
         RETURN canPlace = false
  
  4. Class Availability:
     IF classTimet[className][day][period].subject != '':
       RETURN canPlace = false
  
  5. Lab Conflicts:
     FOR each subject in stream.subjects:
       IF detectLabConflict(className, subject, day, period):
         RETURN canPlace = false
  
  IF all checks pass:
    RETURN canPlace = true
```

### 9.3 Stream Subject Assignment

```javascript
IF stream successfully placed at [day][period]:
  
  FOR each subject in stream.subjects:
    teacher = subject.teacher
    
    // Determine if this subject needs lab
    isLab = determineLabStatus(subject, day, period)
    
    // Record in teacher timetable
    teacherTimetable[teacher][day][period] = {
      className: className,
      subject: subject.subject,
      isStream: true,
      streamName: stream.name,
      isLabPeriod: isLab
    }
    
    // Increment teacher load
    teacherLoad[teacher][day]++
    
  // Record in class timetable
  classTimetable[className][day][period] = {
    subject: stream.abbreviation,
    isStream: true,
    streamName: stream.name,
    subjects: [all subjects in stream]
  }
```

---

## CLUBBED/MERGED CLASS CONDITIONS

### 10.1 Definition

Clubbed Classes = Multiple classes taught by SAME teacher, SAME subject, SAME period

**Example:**
```
Teacher: Mr. Smith
Subject: English
Classes: 9A AND 9B
Period: P2 Tuesday

Mr. Smith teaches English to both 9A and 9B at P2 Tuesday
```

### 10.2 Clubbed Class Placement

```javascript
FOR each clubbed assignment:
  
  Requirement 1: Teacher Availability
    IF teacherTimetable[teacher][day][period] != '':
      RETURN canPlace = false
  
  Requirement 2: All Classes Free
    FOR each class in selectedClasses:
      IF classTimetable[class][day][period].subject != '':
        RETURN canPlace = false
  
  Requirement 3: Same Level
    grades = [extract grade from each class]
    IF not all grades in same level (Middle or Senior):
      RETURN canPlace = false
  
  Requirement 4: Building Constraint
    FOR each class:
      IF isBuildingConstraintViolated(teacher, day, period, class):
        RETURN canPlace = false
  
  Requirement 5: Lab Conflict
    FOR each class:
      IF detectLabConflict(class, subject, day, period):
        RETURN canPlace = false
  
  IF all requirements met:
    RETURN canPlace = true
```

### 10.3 Clubbed Class Recording

```javascript
IF clubbed assignment placed at [day][period]:
  
  FOR each class in selectedClasses:
    classTimetable[class][day][period] = {
      subject: subject_abbreviation,
      fullSubject: subject,
      teacher: teacher_name,
      otherClasses: [other classes in club],
      isLabPeriod: isLab
    }
  
  // Teacher record
  teacherTimetable[teacher][day][period] = {
    className: classes.join('/'),  // e.g., "9A/9B"
    subject: subject,
    isClubbed: true
  }
```

### 10.4 Display Format

```
In Class 9A timetable:
  P2 Tuesday: ENG (A/B) Teacher: Smith
  
In Class 9B timetable:
  P2 Tuesday: ENG (A/B) Teacher: Smith

Indicator "(A/B)" shows classes involved
```

---

## PLACEMENT FALLBACK

### 11.1 Fallback Strategy

```javascript
IF after 3 passes, placed == false:
  
  // Force place using calculated day/period
  day = days[taskIndex % 6]
  (Cycle through: Mon, Tue, Wed, Thu, Fri, Sat)
  
  period = availableSlots[taskIndex % availableSlots.length]
  
  // Place WITHOUT any validation checks
  placeTask(task, day, period)
  
  RETURN task placed (even with conflicts)
```

**Rationale:** Better to have conflict than leave unscheduled

---

## WEEKLY PERIOD TRACKING

### 12.1 Teacher Weekly Load

```javascript
FOR each teacher:
  weeklyPeriods = 0
  
  FOR each day (Mon-Sat):
    FOR each period:
      IF teacher scheduled:
        weeklyPeriods += 1 (for block: already counted as 1 in placeTask)

COMPARISON:
  expectedLoad = sum of all periods from allotments
  
  IF weeklyPeriods < expectedLoad:
    WARNING: Teacher underloaded
  
  IF weeklyPeriods > expectedLoad:
    WARNING: Teacher overloaded
  
  IF weeklyPeriods == expectedLoad:
    SUCCESS: Properly loaded ✓
```

### 12.2 Class Weekly Load

```javascript
FOR each class:
  weeklyPeriods = 0
  
  FOR each day (Mon-Sat):
    FOR each period (except BRK-I, BRK-II, LUNCH):
      IF class has assignment:
        weeklyPeriods += 1

EXPECTED:
  Total available slots per week:
    Middle School: 6 days × 8 periods = 48
    Senior School: 6 days × 8 periods = 48
  
  Less any reserved (breaks, lunch)
```

---

## SWAP/CHAIN OPERATION CONDITIONS

### 13.1 Valid Swap Destination

```javascript
findAvailableDestinations(sourceClass, sourcePeriod, sourceDay):
  
  available = []
  
  FOR each day (Mon-Sat):
    FOR each period (CT, P1-P8):
      
      // Skip source itself
      IF day == sourceDay AND period == sourcePeriod:
        CONTINUE
      
      // Skip lunch periods based on grade
      gradeNum = extractGrade(sourceClass)
      IF gradeNum <= 8 AND period == 'S9':
        CONTINUE
      IF gradeNum >= 9 AND period == 'S10':
        CONTINUE
      
      // Skip if teacher already assigned elsewhere
      IF teacher assigned in this slot:
        AND NOT in "moving out" set:
          CONTINUE
      
      // Check teacher is free (or moving out)
      IF isTeacherFreeInSlot(teacher, day, period):
        available.add({class, day, period})
  
  RETURN available
```

### 13.2 Chain Completion

```javascript
IF swapChain forms a loop:
  // i.e., last swap's source == first swap's destination
  
  THEN isChainComplete = true
  
  Apply all swaps atomically
```

---

## VALIDATION & VERIFICATION

### 14.1 Teacher Verification (PDF vs App)

```javascript
FOR each teacher in generated timetable:
  
  Step 1: Extract teacher block from PDF
    blockContent = extractPDFBlockForTeacher(teacher)
  
  Step 2: Extract words from PDF block
    pdfWords = tokenize(blockContent)
  
  Step 3: Check each class in teacher's schedule
    FOR each class in teacher_schedule:
      IF class_name NOT in pdfWords:
        mismatch_found = true
        report.warnings.add(`${teacher}: ${class} not in PDF`)

RESULT:
  If all classes found in PDF: status = 'OK'
  If some classes missing: status = 'MISMATCH'
  If teacher not in PDF: status = 'MISSING_IN_PDF'
```

### 14.2 Data Integrity Checks

All timetables must satisfy:

```javascript
CHECK 1: No empty assignments
  FOR each cell:
    IF cell.teacher == '' AND cell.subject != '':
      ERROR: Teacher missing for subject

CHECK 2: No duplicate assignments
  FOR each [class, day, period]:
    IF multiple subjects assigned:
      ERROR: Duplicate assignment

CHECK 3: Reserved periods protected
  FOR each [class, day, period]:
    IF period in [BRK-I, BRK-II, LUNCH]:
      IF cell.subject != '' AND cell.subject not in ['BREAK', 'LUNCH']:
        ERROR: Subject assigned to break/lunch

CHECK 4: Teacher name consistency
  FOR each teacher name:
    name = name.trim().toUpperCase()
    IF inconsistent casing:
      WARNING: Normalize name

CHECK 5: Class name validity
  FOR each class:
    IF not in valid class list:
      WARNING: Unknown class?
```

---

## REAL-WORLD EXAMPLE

### Scenario: Assign Math to Class 9A

**Given:**
- Teacher: Smith
- Subject: Math
- Class: 9A
- Required: 1 block (P1-P2) + 3 singles (P3, P4, P5)
- Preferred Day: Any
- Lab Periods: 0 (no lab needed)

### Step-by-Step Execution

```
STEP 1: Create Tasks
  Task 1: type=BLOCK, subject=Math, teacher=Smith, className=9A
  Task 2: type=SINGLE, subject=Math, teacher=Smith, className=9A
  Task 3: type=SINGLE, subject=Math, teacher=Smith, className=9A
  Task 4: type=SINGLE, subject=Math, teacher=Smith, className=9A

STEP 2: Sort by Priority
  Priority Order: Task 1 (BLOCK) > Tasks 2,3,4 (SINGLEs)

STEP 3: Place Task 1 (Block P1-P2)

  Pass 1 (Ideal Spread):
    Day = Monday
    Check: Smith free P1-P2? YES ✓
    Check: 9A free P1-P2? YES ✓
    Check: Math not on Monday? YES ✓
    Check: Load + 2 <= 6? YES ✓
    Check: Building constraint? NO CONFLICT ✓
    → PLACE at Monday P1-P2 ✓
    
    Load Update:
      smithLoad[Monday] = 2
      9aLoad[Monday] = 2

STEP 4: Place Task 2 (Single P3)

  Pass 1 (Ideal Spread):
    Try Tuesday:
      Check: Smith free P3 Tuesday? YES ✓
      Check: 9A free P3 Tuesday? YES ✓
      Check: Math not on Tuesday? YES ✓
      Check: Load + 1 <= 6? YES (2+1=3) ✓
      Check: Building constraint? NO CONFLICT ✓
      → PLACE at Tuesday P3 ✓
      
      Load Update:
        smithLoad[Tuesday] = 1
        9aLoad[Tuesday] = 1

STEP 5: Place Task 3 (Single P4)

  Pass 1 (Ideal Spread):
    Try Wednesday:
      All checks pass ✓
      → PLACE at Wednesday P4 ✓

STEP 6: Place Task 4 (Single P5)

  Pass 1 (Ideal Spread):
    Try Thursday:
      All checks pass ✓
      → PLACE at Thursday P5 ✓

FINAL RESULT:
  Monday:     P1-P2 Math (Smith)
  Tuesday:    P3 Math (Smith)
  Wednesday:  P4 Math (Smith)
  Thursday:   P5 Math (Smith)
  
  Smith's load: 2 + 1 + 1 + 1 = 5 periods per week ✓
  Class 9A: Math appears 4 separate slots ✓
```

---

## QUICK REFERENCE CHECKLIST

Before placing ANY period, verify ALL these conditions:

```
□ TEACHER AVAILABILITY
  ✓ Teacher has no other assignment at [day][period]
  ✓ Teacher's daily load + this period <= 6
  ✓ No building constraint violation

□ CLASS AVAILABILITY
  ✓ Class has no other assignment at [day][period]
  ✓ Period is not reserved (BRK-I, BRK-II, LUNCH)
  ✓ Period is valid for class level

□ PERIOD & LEVEL
  ✓ Period exists in class's available slots
  ✓ For blocks: both periods in pair available and consecutive

□ CLUSTERING & SPREAD
  ✓ Pass 1: Subject not already on day (or relax for Pass 2/3)
  ✓ Subject clustering rules met for current pass
  ✓ Daily load limit respected

□ LAB RESOURCE
  ✓ If subject uses lab: target lab not occupied
  ✓ Lab quota not exceeded
  ✓ Lab conflict detection passed

□ SPECIAL ASSIGNMENTS
  ✓ For STREAMS: all teachers free and no building conflicts
  ✓ For CLUBBED: all classes free and same level

□ BUILD & COMPATIBILITY
  ✓ For TWO-period blocks: both periods are valid pair
  ✓ Adjacent building constraint (if applicable)
  ✓ Preferred day constraint (if applicable)

ONLY IF ALL PASS → PLACE PERIOD
OTHERWISE → TRY NEXT SLOT
```

---

## Code References

- **Main Engine:** `src/utils/timetableGenerator.js`
- **Lab Validation:** `src/utils/labSharingValidation.js`
- **Swap Logic:** `src/utils/chainSwapUtils.js`
- **Class Utilities:** `src/utils/classTTUtils.js`
- **Verification:** `src/utils/verificationLogic.js`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Mar 1, 2026 | Initial comprehensive documentation |

---

**End of Document**
