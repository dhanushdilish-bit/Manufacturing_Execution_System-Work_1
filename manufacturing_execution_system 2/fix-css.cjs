const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'App.css');
let css = fs.readFileSync(cssPath, 'utf8');

const replacements = [
  { regex: /#17211d/gi, replace: 'var(--text-main)' },
  { regex: /#69746e/gi, replace: 'var(--text-muted)' },
  { regex: /#202623/gi, replace: 'var(--text-main)' },
  { regex: /#26302c/gi, replace: 'var(--text-main)' },
  { regex: /#d9ded6/gi, replace: 'var(--border)' },
  { regex: /#e6eae2/gi, replace: 'var(--border)' },
  { regex: /#cfd8d1/gi, replace: 'var(--border)' },
  { regex: /#ffffff/gi, replace: 'transparent' }, // we will manually fix background: transparent to bg-panel
  { regex: /#e5f3ef/gi, replace: 'rgba(56, 189, 248, 0.1)' },
  { regex: /#0f766e/gi, replace: 'var(--primary)' },
  { regex: /#f1f8f6/gi, replace: 'rgba(255, 255, 255, 0.05)' },
  { regex: /#047857/gi, replace: 'var(--primary)' }, // specific green
  { regex: /#065f46/gi, replace: 'var(--primary-hover)' },
  { regex: /#f0fdf4/gi, replace: 'rgba(56, 189, 248, 0.1)' },
  { regex: /#10b981/gi, replace: '#10b981' }, // status badge green, keep it or use primary
  { regex: /#ef4444/gi, replace: '#ef4444' }, // red
  { regex: /#fef2f2/gi, replace: 'rgba(239, 68, 68, 0.1)' }, // light red bg
  { regex: /#f59e0b/gi, replace: '#f59e0b' }, // amber
  { regex: /#fffbeb/gi, replace: 'rgba(245, 158, 11, 0.1)' }, // light amber bg
  { regex: /#3b82f6/gi, replace: '#3b82f6' }, // blue
  { regex: /#eff6ff/gi, replace: 'rgba(59, 130, 246, 0.1)' }, // light blue bg
  { regex: /#f8fafc/gi, replace: 'rgba(255,255,255,0.02)' }, // grey bg
  { regex: /#cbd5e1/gi, replace: 'var(--border)' },
  { regex: /#e2e8f0/gi, replace: 'var(--border)' },
  { regex: /#334155/gi, replace: 'var(--text-main)' }
];

for (const {regex, replace} of replacements) {
  css = css.replace(regex, replace);
}

// Manually fix panels and sidebars to have panel background, not transparent
css = css.replace(/\.sidebar \{\s*position/g, '.sidebar {\n  background: var(--bg-panel);\n  position');
css = css.replace(/\.panel \{\s*display/g, '.panel {\n  background: var(--bg-panel);\n  display');
css = css.replace(/\.panel\.wide \{\s*grid-column/g, '.panel.wide {\n  background: var(--bg-panel);\n  grid-column');
css = css.replace(/\.topbar \{\s*display/g, '.topbar {\n  background: var(--bg-panel);\n  display');

// Fix buttons background
css = css.replace(/background: transparent;\s*color: var\(--text-main\);\s*cursor/g, 'background: rgba(255, 255, 255, 0.05);\n  color: var(--text-main);\n  cursor');
css = css.replace(/\.primary-button \{\s*background: var\(--primary\);\s*color: transparent;/g, '.primary-button {\n  background: var(--primary);\n  color: #fff;');

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS transformed successfully.');
