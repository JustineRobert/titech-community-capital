# Vite Migration - Quick Reference

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:3000)
npm start

# Build for production
npm run build

# Run tests
npm test
```

## 📝 Important Changes

### Environment Variables

**OLD (React Scripts):**

```javascript
process.env.REACT_APP_API_URL;
```

**NEW (Vite):**

```javascript
import.meta.env.VITE_API_URL;
```

### Variable Names

| Old                | New           |
| ------------------ | ------------- |
| REACT_APP_API_URL  | VITE_API_URL  |
| REACT_APP_APP_NAME | VITE_APP_NAME |

See `.env.example` for complete list.

## 📦 What Changed

| Item             | Before           | After        |
| ---------------- | ---------------- | ------------ |
| Build Tool       | Create React App | Vite         |
| Test Runner      | Jest             | Vitest       |
| Entry Point      | src/index.js     | src/main.jsx |
| Dev Server Speed | 10-15s           | 2-3s         |
| HMR Speed        | 5-8s             | 100-500ms    |

## ✅ What Stayed the Same

- All React components
- Redux store
- React Router
- CSS/Tailwind
- API services
- Directory structure

## 🎨 Designer Logo

- **Favicon**: `public/images/Designer.png`
- **Navbar Logo**: Displays in top navigation
- **Apple Touch Icon**: For iOS home screen

## 📚 Full Documentation

See `VITE_MIGRATION_GUIDE.md` and `VITE_MIGRATION_COMPLETE.md`

## 🔧 Common Tasks

```bash
# Development
npm start                    # Start dev server
npm run dev                  # Alternative dev command

# Production
npm run build               # Build for production
npm run preview             # Preview production build

# Testing
npm test                    # Run tests once
npm test -- --watch        # Watch mode
npm test -- --ui           # Visual dashboard

# Maintenance
npm install                 # Install/update dependencies
npm audit fix              # Fix vulnerabilities
```

## ⚠️ Important Notes

1. **Restart Dev Server**: After adding new environment variables, restart the dev server
2. **Variable Prefix**: All env variables must start with `VITE_`
3. **Access Pattern**: Use `import.meta.env.VITE_*` not `process.env`
4. **No More react-scripts**: Cannot use CRA-specific commands

## 🐛 Troubleshooting

**Module not found?**

- Restart dev server: `npm start`

**Env variables not working?**

- Must start with `VITE_` prefix
- Restart dev server
- Use `import.meta.env.VITE_*` to access

**HMR not updating?**

- Check dev server is running
- Try browser refresh

**Build too large?**

- Check `vite.config.js` build settings
- Run with `npm run build` (includes minification)

## 📖 Resources

- [Vite Docs](https://vitejs.dev)
- [Vitest Docs](https://vitest.dev)
- [VITE_MIGRATION_GUIDE.md](./VITE_MIGRATION_GUIDE.md)

---

**Need help?** Check the migration guide or vite.config.js file.
