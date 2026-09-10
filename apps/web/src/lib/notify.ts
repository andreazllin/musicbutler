import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { createElement } from "react";

/**
 * The app's toasts (docs/PLAN.md §7.7). One wrapper so every call site gets the
 * same color, icon and dwell time, and so the notification library is named in
 * one file.
 */
const show = (color: string, icon: typeof IconCheck, message: string, autoClose: number | false) =>
	notifications.show({
		message,
		color,
		icon: createElement(icon, { size: 18 }),
		autoClose,
		withBorder: true,
	});

export const notify = {
	success: (message: string) => show("teal", IconCheck, message, 4000),
	/** Errors stay until dismissed: the user usually has to act on them. */
	error: (message: string) => show("red", IconX, message, false),
	info: (message: string) => show("blue", IconInfoCircle, message, 5000),
	warning: (message: string) => show("yellow", IconAlertTriangle, message, 6000),
};
