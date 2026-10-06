import { Minus, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InventarioItem } from '@/types/domain';
import type { NuevoInsumoInput } from './my-center-api';
import {
  buildInsumoInput,
  clampWithdrawal,
  emptyInsumoRow,
  type InsumoRow,
  type InsumoRowErrors,
  MAX_NOMBRE_INSUMO,
  onlyDigits,
  validateInsumoRow,
} from './my-center-form';

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface AddSupplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the center already declares, to reject a repeated supply up front. */
  existingNames: readonly string[];
  /** Declares the supply. A rejection keeps the dialog open and shows its message. */
  onSubmit: (input: NuevoInsumoInput) => Promise<void>;
}

/**
 * "Agregar insumo": a new supply the center asks for, with what it has today
 * and the maximum it needs.
 */
export function AddSupplyDialog({
  open,
  onOpenChange,
  existingNames,
  onSubmit,
}: AddSupplyDialogProps) {
  const [row, setRow] = useState<InsumoRow>(emptyInsumoRow);
  const [errors, setErrors] = useState<InsumoRowErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRow(emptyInsumoRow());
    setErrors({});
    setSubmitting(false);
    setSubmitError(null);
  }, [open]);

  // Editing a field drops its own message, so a corrected value never keeps a
  // stale red line; the next submit validates everything again.
  const patchRow = (patch: Partial<InsumoRow>) => {
    setRow((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch) as (keyof InsumoRowErrors)[]) {
        delete next[field];
      }
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateInsumoRow(
      row,
      existingNames.map((name) => name.trim().toLowerCase()),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const input = buildInsumoInput(row);
    if (!input) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'No se pudo agregar el insumo. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="add-supply-desc">
        <DialogHeader>
          <DialogTitle>Agregar insumo</DialogTitle>
          <DialogDescription id="add-supply-desc">
            Declara un insumo nuevo que tu centro necesita.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-supply-name" className="nv-label text-muted-foreground">
              Insumo
            </label>
            <input
              id="add-supply-name"
              type="text"
              autoComplete="off"
              maxLength={MAX_NOMBRE_INSUMO}
              placeholder="Ej.: Kits de higiene"
              value={row.nombre}
              onChange={(event) => patchRow({ nombre: event.target.value })}
              aria-invalid={Boolean(errors.nombre)}
              className={FIELD_CLASS}
            />
            {errors.nombre && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.nombre}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="add-supply-available" className="nv-label text-muted-foreground">
                Tengo hoy
              </label>
              <input
                id="add-supply-available"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={row.disponible}
                onChange={(event) => patchRow({ disponible: onlyDigits(event.target.value) })}
                aria-invalid={Boolean(errors.disponible)}
                className={`${FIELD_CLASS} tabular`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="add-supply-required" className="nv-label text-muted-foreground">
                Máximo que necesita
              </label>
              <input
                id="add-supply-required"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={row.requerido}
                onChange={(event) => patchRow({ requerido: onlyDigits(event.target.value) })}
                aria-invalid={Boolean(errors.requerido)}
                className={`${FIELD_CLASS} tabular`}
              />
            </div>
          </div>
          {(errors.disponible || errors.requerido) && (
            <p role="alert" className="text-critical text-[11px]">
              {[errors.disponible, errors.requerido].filter(Boolean).join(' ')}
            </p>
          )}

          {submitError && (
            <p role="alert" className="text-critical text-[11px]">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Agregando…' : 'Agregar insumo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface WithdrawSupplyDialogProps {
  /** The supply being withdrawn from; `null` keeps the dialog closed. */
  item: InventarioItem | null;
  onClose: () => void;
  /** Withdraws the units. A rejection keeps the dialog open and shows its message. */
  onSubmit: (item: InventarioItem, cantidad: number) => Promise<void>;
}

/**
 * "Retirar": units of a supply that left the center (delivered, handed to
 * another center, spoiled). The amount can never exceed what the center has, and
 * the dialog shows how many will be left before confirming.
 */
export function WithdrawSupplyDialog({ item, onClose, onSubmit }: WithdrawSupplyDialogProps) {
  // `null` while the field is cleared to type a new number; restored on blur.
  const [rawAmount, setRawAmount] = useState<number | null>(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const itemId = item?.id ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when another supply opens.
  useEffect(() => {
    setRawAmount(1);
    setSubmitting(false);
    setSubmitError(null);
  }, [itemId]);

  if (!item) {
    return null;
  }

  const disponible = item.disponible;
  const amount = clampWithdrawal(rawAmount ?? 1, disponible);
  const remaining = disponible - amount;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (amount < 1) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(item, amount);
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'No se pudieron retirar las unidades. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent aria-describedby="withdraw-supply-desc">
        <DialogHeader>
          <DialogTitle>Retirar {item.nombre}</DialogTitle>
          <DialogDescription id="withdraw-supply-desc">
            Indica cuántas unidades salieron del centro. Tienes {disponible} de {item.requerido}.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div>
            <span className="nv-label text-muted-foreground">Cantidad a retirar</span>
            <div className="mt-2 flex h-[52px] items-center overflow-hidden rounded-nv-md border-[1.5px] border-nv-line">
              <button
                type="button"
                aria-label="Quitar uno"
                onClick={() => setRawAmount(amount - 1)}
                disabled={amount <= 1}
                className="flex h-full w-14 items-center justify-center bg-nv-mint text-nv-navy disabled:opacity-40"
              >
                <Minus className="size-5" aria-hidden />
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Cantidad a retirar"
                value={rawAmount === null ? '' : amount}
                onChange={(event) => {
                  const digits = onlyDigits(event.target.value);
                  setRawAmount(digits === '' ? null : Number(digits));
                }}
                onBlur={() => setRawAmount(amount)}
                onFocus={(event) => event.target.select()}
                className="tabular h-full min-w-0 flex-1 border-0 bg-transparent text-center font-bold text-xl outline-none focus:bg-nv-mint"
              />
              <button
                type="button"
                aria-label="Agregar uno"
                onClick={() => setRawAmount(amount + 1)}
                disabled={amount >= disponible}
                className="flex h-full w-14 items-center justify-center bg-nv-mint text-nv-navy disabled:opacity-40"
              >
                <Plus className="size-5" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-muted-foreground text-xs">
              Máximo {disponible}: lo que tiene el centro.
            </p>
          </div>

          <p data-testid="withdraw-preview" className="rounded-md bg-muted px-2 py-1.5 text-sm">
            Quedarán <b>{remaining}</b> de {item.requerido}.
          </p>

          {submitError && (
            <p role="alert" className="text-critical text-[11px]">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || amount < 1}>
              {submitting ? 'Retirando…' : `Retirar ${amount}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
