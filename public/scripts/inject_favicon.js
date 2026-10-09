const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

walkDir('./public', function (filePath) {
    if (filePath.endsWith('.html')) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (!content.includes('ICON.ico') && content.includes('<head>')) {
            content = content.replace('<head>', '<head>\n    <link rel="icon" type="image/x-icon" href="/assets/ICON.ico">');
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Added Favicon to:', filePath);
        } else {
            console.log('Skipped (already has icon or no head tag):', filePath);
        }
    }
});

console.log('🎉 Favicon injection completed!');
