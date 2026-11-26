import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** A Hub-styled replacement for window.confirm:
 *  const [ask, confirmDialog] = useConfirm();  if (!(await ask({...}))) return;
 *  and render {confirmDialog} once. */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  const dialog = (
    <AlertDialog open={opts !== null} onOpenChange={(open) => !open && finish(false)}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.body ? (
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{opts.body}</div>
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>{opts?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(opts?.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={() => finish(true)}
          >
            {opts?.confirmLabel ?? "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [ask, dialog];
}
