# Urban Service Inequality — Colombo District Web GIS

An interactive spatial evaluation platform designed to systematically identify and monitor geographic service disparities across the GN Divisions of the Colombo District.

## Features

1. **Dual-Theme Choropleth Visualization:** Dynamic quantile classification rendering for both the `Accessibility Index (AI)` and `Priority Areas`.
2. **Layer Infrastructure Controls:** Toggle point networks (Hospitals, Schools, Banks, Parks, and Bus Stops) with live totals.
3. **Seamless Google Forms Database Connection:** Configured with a background `<form>` tracking architecture targeting an implicit interface hidden `<iframe>`. This approach lets users complete the natively-styled sidebar form UI, saving data directly into Google Sheets while bypassing browser CORS constraints.
4. **Interactive Local Sync:** Successfully saved records generate interactive lists within the side panel. Clicking a record re-centers the viewport and renders a high-visibility star indicator (`⭐`).

## Local Setup & Configuration

1. Place your vector spatial datasets matching the references defined inside the `DATA_FILES` object in `script.js` into your local `data/` directory.
2. Open your public live Google Form in a browser tab, inspect its input nodes, and replace the placeholder keys (`entry.111111111`, `YOUR_GOOGLE_FORM_ID`, etc.) inside the `index.html` form layout with your verified production parameter tokens.
3. Launch via any local testing environment or server system (e.g., VS Code Live Server).