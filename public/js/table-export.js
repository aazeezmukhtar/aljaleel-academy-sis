/**
 * Exports an HTML table to CSV
 * @param {string} tableId - The ID of the table to export
 * @param {string} filename - The desired filename for the CSV
 */
function exportTableToCSV(tableSelector, filename) {
    const table = document.querySelector(tableSelector);
    if (!table) return alert('Table not found!');

    let csv = [];
    const rows = table.querySelectorAll("tr");

    for (let i = 0; i < rows.length; i++) {
        const row = [];
        const cols = rows[i].querySelectorAll("td, th");

        for (let j = 0; j < cols.length; j++) {
            // Clean inner text: remove double quotes, newlines, etc.
            let data = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, "").trim();
            // Escape double quotes
            data = data.replace(/"/g, '""');
            // Enclose in double quotes
            row.push('"' + data + '"');
        }

        csv.push(row.join(","));
    }

    downloadCSV(csv.join("\n"), filename);
}

function downloadCSV(csv, filename) {
    const csvFile = new Blob([csv], { type: "text/csv" });
    const downloadLink = document.createElement("a");

    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";

    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

// Auto-attach to buttons with class 'btn-export'
document.addEventListener('DOMContentLoaded', () => {
    const exportBtns = document.querySelectorAll('.btn-export');
    exportBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tableSelector = btn.dataset.target || '.report-table';
            const filename = btn.dataset.filename || 'report.csv';
            exportTableToCSV(tableSelector, filename);
        });
    });
});
