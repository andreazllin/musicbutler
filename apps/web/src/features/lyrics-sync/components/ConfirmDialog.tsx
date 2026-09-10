import { Button, Group, Modal, Stack } from "@mantine/core";
import type { FunctionComponent, ReactNode } from "react";

type Props = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	children: ReactNode;
	confirmLabel: string;
	/** `red` marks a destructive confirm; anything else uses the brand color. */
	confirmColor?: "brand" | "red";
	onConfirm: () => void;
	isConfirming?: boolean;
	/** Extra footer actions rendered between Cancel and the confirm button. */
	secondaryAction?: ReactNode;
};

/**
 * A small confirmation dialog on Mantine's Modal. Cancel carries `data-autofocus`
 * so it receives focus when the dialog opens (docs/PLAN.md §7.5) and Enter never
 * confirms by accident.
 */
export const ConfirmDialog: FunctionComponent<Props> = ({
	isOpen,
	onOpenChange,
	title,
	children,
	confirmLabel,
	confirmColor = "brand",
	onConfirm,
	isConfirming,
	secondaryAction,
}) => (
	<Modal
		opened={isOpen}
		onClose={() => onOpenChange(false)}
		title={title}
		size="lg"
		centered
		role="alertdialog"
	>
		<Stack gap="sm" fz="sm" c="dimmed">
			{children}
		</Stack>
		<Group justify="flex-end" gap="sm" mt="xl">
			<Button variant="default" data-autofocus onClick={() => onOpenChange(false)}>
				Cancel
			</Button>
			{secondaryAction}
			<Button color={confirmColor} loading={isConfirming} onClick={onConfirm}>
				{confirmLabel}
			</Button>
		</Group>
	</Modal>
);
