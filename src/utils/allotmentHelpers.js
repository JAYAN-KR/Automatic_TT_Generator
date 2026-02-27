/**
 * Calculates the total weekly period load for a teacher's allotments.
 * Total = Sum of (PPS * number of classes) for each allotment group.
 */
export const calculateTotalLoad = (allotments) => {
    if (!allotments || !Array.isArray(allotments)) return 0;
    return allotments.reduce((sum, group) => {
        const pps = Number(group.periods) || 0;
        return sum + pps;
    }, 0);
};

/**
 * Updates a specific field in an allotment group and recalculates totals.
 */
export const updateAllotmentGroupData = (allotments, groupIndex, field, value) => {
    const newGroups = [...allotments];
    const updatedGroup = { ...newGroups[groupIndex] };

    if (field === 'classes') {
        updatedGroup.classes = Array.isArray(value) ? value : [value];
    } else if (field === 'periods') {
        const numVal = Number(value);
        updatedGroup.periods = numVal;
        // Reset blocks if PPS is 0
        if (numVal === 0) {
            updatedGroup.tBlock = 0;
            updatedGroup.lBlock = 0;
        }
    } else {
        updatedGroup[field] = value;
    }

    newGroups[groupIndex] = updatedGroup;
    return {
        allotments: newGroups,
        total: calculateTotalLoad(newGroups)
    };
};
