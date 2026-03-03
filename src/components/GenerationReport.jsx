import React from 'react';
import * as XLSX from 'xlsx';

const GenerationReport = ({ report, onClose }) => {
    if (!report) return null;
    const { placedPeriods = 0, placedTasks = [], failedPeriods = 0, failedTasks = [], violations = [] } = report;
    const successCount = placedPeriods;
    const failureCount = failedPeriods;
    const issueCount = violations.length;

    const buildCSV = () => {
        const lines = [];
        // Summary header
        lines.push('Summary,PlacedPeriods,FailedPeriods,Issues');
        lines.push(["SUMMARY", successCount, failureCount, issueCount].map(v => `"${v}"`).join(','));
        lines.push('');
        lines.push('Type,Teacher,Subject,Class,Periods,Details');
        placedTasks.forEach(p => {
            lines.push(
                [`PLACED`, p.teacher, p.subject, p.className, p.periods, p.details || ''].map(v => `"${v}"`).join(',')
            );
        });
        failedTasks.forEach(f => {
            lines.push(
                [`FAILED`, f.teacher, f.subject, f.className, f.periods, f.reason].map(v => `"${v}"`).join(',')
            );
        });
        violations.forEach(v => {
            lines.push(
                [`VIOLATION`, v.teacher, v.subject, v.className, '', `${v.violationType}: ${v.details}`]
                    .map(x => `"${x}"`).join(',')
            );
        });
        return lines.join('\n');
    };

    const exportCSV = () => {
        const csv = buildCSV();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'generation_report.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportExcel = () => {
        const wsData = [];
        wsData.push(['Type','Teacher','Subject','Class','Periods','Details']);
        placedTasks.forEach(p => wsData.push(['PLACED', p.teacher, p.subject, p.className, p.periods, p.details || '']));
        failedTasks.forEach(f => wsData.push(['FAILED', f.teacher, f.subject, f.className, f.periods, f.reason]));
        violations.forEach(v => wsData.push(['VIOLATION', v.teacher, v.subject, v.className, '', `${v.violationType}: ${v.details}`]));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
        XLSX.writeFile(wb, 'generation_report.xlsx');
    };

    const copyClipboard = () => {
        const csv = buildCSV();
        navigator.clipboard.writeText(csv);
        alert('Report copied to clipboard');
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
            <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '0.5rem', width: '90%', maxWidth: '800px', maxHeight: '90%', overflowY: 'auto' }}>
                <h2>📊 TIMETABLE GENERATION REPORT</h2>
                <hr />
                <p>✅ SUCCESSFULLY PLACED: {successCount} periods</p>
                <p>❌ FAILED TO PLACE: {failureCount} periods</p>
                <p>⚠️ RULE VIOLATIONS DETECTED: {issueCount} issues</p>

                {placedTasks.length > 0 && (
                    <>
                        <h3>✅ PERIODS PLACED</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                            <thead>
                                <tr><th>Teacher</th><th>Subject</th><th>Class</th><th>Periods</th><th>Details</th></tr>
                            </thead>
                            <tbody>
                                {placedTasks.map((p,i) => (
                                    <tr key={i} style={{ borderTop: '1px solid #ccc' }}>
                                        <td>{p.teacher}</td><td>{p.subject}</td><td>{p.className}</td><td>{p.periods}</td><td>{p.details}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {failureCount > 0 && (
                    <>
                        <h3>❌ PERIODS THAT COULD NOT BE PLACED</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                            <thead>
                                <tr><th>Teacher</th><th>Subject</th><th>Class</th><th>Periods</th><th>Reason</th></tr>
                            </thead>
                            <tbody>
                                {failedTasks.map((f,i) => (
                                    <tr key={i} style={{ borderTop: '1px solid #ccc' }}>
                                        <td>{f.teacher}</td><td>{f.subject}</td><td>{f.className}</td><td>{f.periods}</td><td>{f.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                {issueCount > 0 && (
                    <>
                        <h3>⚠️ SCHEDULING RULE VIOLATIONS</h3>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                            <thead>
                                <tr><th>Teacher</th><th>Subject</th><th>Class</th><th>Type</th><th>Details</th></tr>
                            </thead>
                            <tbody>
                                {violations.map((v,i) => (
                                    <tr key={i} style={{ borderTop: '1px solid #ccc' }}>
                                        <td>{v.teacher}</td><td>{v.subject}</td><td>{v.className}</td><td>{v.violationType}</td><td>{v.details}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                <div style={{ textAlign: 'right' }}>
                    <button onClick={exportCSV} style={{ marginRight: '0.5rem' }}>📥 Export as CSV</button>
                    <button onClick={exportExcel} style={{ marginRight: '0.5rem' }}>📥 Export as Excel</button>
                    <button onClick={copyClipboard} style={{ marginRight: '0.5rem' }}>📋 Copy to Clipboard</button>
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default GenerationReport;
