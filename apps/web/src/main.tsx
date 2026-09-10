import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "@/router";
import { AppProviders } from "@/router/providers";
// Mantine's stylesheets must load before any CSS module, which is why they are
// imported here and not from a component.
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@/styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing the #root element");

createRoot(rootElement).render(
	<StrictMode>
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	</StrictMode>,
);
