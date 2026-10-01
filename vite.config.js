import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  appType: "mpa",
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "website-design": resolve(__dirname, "website-design/index.html"),
        "ios-apps": resolve(__dirname, "ios-apps/index.html"),
        ads: resolve(__dirname, "ads/index.html"),
        work: resolve(__dirname, "work/index.html"),
        "work/pitter-potter": resolve(__dirname, "work/pitter-potter/index.html"),
        "work/jm2-tiling": resolve(__dirname, "work/jm2-tiling/index.html"),
        "work/monkeying-around": resolve(__dirname, "work/monkeying-around/index.html"),
        "work/lrso": resolve(__dirname, "work/lrso/index.html"),
        "work/the-slime-studio": resolve(__dirname, "work/the-slime-studio/index.html"),
        "work/citysafe-locksmith": resolve(__dirname, "work/citysafe-locksmith/index.html"),
        "work/highlife-games": resolve(__dirname, "work/highlife-games/index.html"),
        "work/higher-heights-roofing": resolve(__dirname, "work/higher-heights-roofing/index.html"),
        "work/jonny-carr-cue": resolve(__dirname, "work/jonny-carr-cue/index.html"),
        admin: resolve(__dirname, "admin.html"),
        portal: resolve(__dirname, "portal.html"),
        invoice: resolve(__dirname, "invoice.html"),
        "404": resolve(__dirname, "404.html"),
      },
    },
  },
  server: {
    open: true,
  },
});
