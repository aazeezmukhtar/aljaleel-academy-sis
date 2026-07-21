const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.ejs')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk(viewsDir);

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    // Replace term selects
    content = content.replace(/(<select[^>]*name="term"[^>]*>)([\s\S]*?)(<\/select>)/gi, (match, p1, p2, p3) => {
        return p1 + `\n                                <% available_terms.forEach(t => { %>\n                                    <option value="<%= t %>" <%= (typeof filters !== 'undefined' ? filters.term : (typeof query !== 'undefined' ? query.term : (typeof school !== 'undefined' ? school.current_term : '1st Term'))) === t ? 'selected' : '' %>><%= t %></option>\n                                <% }) %>\n                            ` + p3;
    });

    // Replace session selects
    content = content.replace(/(<select[^>]*name="session"[^>]*>)([\s\S]*?)(<\/select>)/gi, (match, p1, p2, p3) => {
        return p1 + `\n                                <% available_sessions.forEach(s => { %>\n                                    <option value="<%= s %>" <%= (typeof filters !== 'undefined' ? filters.session : (typeof query !== 'undefined' ? query.session : (typeof school !== 'undefined' ? school.current_session : '2024/2025'))) === s ? 'selected' : '' %>><%= s %></option>\n                                <% }) %>\n                            ` + p3;
    });

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Updated', file);
    }
});

console.log('Done replacing hardcoded dropdowns in EJS!');
