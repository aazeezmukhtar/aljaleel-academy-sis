const fs = require('fs');
const file = 'views/results/manager.ejs';
let content = fs.readFileSync(file, 'utf8');

// Find and inject after the closing </form> tag (within the filter section, before </div> and the else block)
const searchStr = '                    </form>\r\n                </div>\r\n                <% } else { %>';
const injectScript = `                    </form>\r\n                    <script>\r\n                        // Auto-switch Session and Term based on selected Class's Section\r\n                        (function() {\r\n                            const classDropdown = document.querySelector('select[name="class_id"]');\r\n                            if (classDropdown) {\r\n                                const classData = <%- JSON.stringify(classes.map(c => ({ id: c.id, session: c.sec_session, term: c.sec_term }))) %>;\r\n                                classDropdown.addEventListener('change', function() {\r\n                                    const selected = classData.find(c => String(c.id) === String(this.value));\r\n                                    if (selected) {\r\n                                        if (selected.session) document.querySelector('select[name="session"]').value = selected.session;\r\n                                        if (selected.term) document.querySelector('select[name="term"]').value = selected.term;\r\n                                    }\r\n                                });\r\n                            }\r\n                        })();\r\n                    </script>\r\n                </div>\r\n                <% } else { %>`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, injectScript);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Success: auto-select script injected into manager.ejs');
} else {
    // Try with \n only
    const searchStrLF = '                    </form>\n                </div>\n                <% } else { %>';
    if (content.includes(searchStrLF)) {
        const injectScriptLF = injectScript.replace(/\r\n/g, '\n');
        content = content.replace(searchStrLF, injectScriptLF);
        fs.writeFileSync(file, content, 'utf8');
        console.log('Success (LF): auto-select script injected into manager.ejs');
    } else {
        console.log('Could not find target string. Dumping context around </form>...');
        const idx = content.indexOf('</form>');
        console.log(JSON.stringify(content.substring(idx, idx + 80)));
    }
}
