/* The board's variables and resets, so a component is laid out as it is in
   the app. */
import "@/app/globals.css";

/* `next/font` names the two families on <html> in the app's layout, and no
   layout is mounted here. Without them a rule that reads only the variable
   falls back to the browser's serif, and code in the box would not be the
   page's mono. The fonts themselves are not fetched: the names are enough. */
document.documentElement.style.setProperty("--font-sans", '"IBM Plex Sans"');
document.documentElement.style.setProperty("--font-mono", '"IBM Plex Mono"');
