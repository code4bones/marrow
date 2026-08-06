import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Vite hardcodes `crossorigin` on built <script>/<link> tags with no config
// toggle. That forces those requests into anonymous CORS mode, which drops
// cached HTTP Basic-Auth credentials the browser used for the document
// request itself — behind an nginx/NPM Access List this causes an infinite
// Basic-Auth reprompt loop after the first successful login. All our assets
// are same-origin, so the attribute buys nothing here; strip it.
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/\s+crossorigin(="[^"]*")?/g, '');
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stripCrossorigin()],
})
