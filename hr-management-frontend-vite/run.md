rm -rf dist node_modules/.vite
npm install
npm run build


rm -rf dist
npm run build -- --mode production

pm2 start python3 --name hrm-frontend -- -m http.server 4000

pm2 start server.js --name hrm-backend


# run on tmux


npm run build && npx serve -s dist -l 5180

or 
npx serve -s dist -l 5180


admin@debox.com / Admin@123