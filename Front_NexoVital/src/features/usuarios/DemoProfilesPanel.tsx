import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { DEMO_USERS, type DemoUser } from './session';

/** Seeded profiles bucketed by role, so repeated roles collapse into one entry. */
interface ProfileGroup {
  rol: DemoUser['rol'];
  profiles: DemoUser[];
}

/** Bucket the profiles by role, preserving the declaration order of DEMO_USERS. */
function groupByRole(profiles: DemoUser[]): ProfileGroup[] {
  const groups = new Map<DemoUser['rol'], DemoUser[]>();
  for (const profile of profiles) {
    const bucket = groups.get(profile.rol);
    if (bucket) {
      bucket.push(profile);
    } else {
      groups.set(profile.rol, [profile]);
    }
  }
  return [...groups].map(([rol, items]) => ({ rol, profiles: items }));
}

/**
 * Roles the MVP offers on the login panel: citizen, ambulance driver and the
 * help-center administrator (the actor of EP-03.F1.US1).
 *
 * The other seeded administrator accounts still exist in the database and still
 * sign in if their credentials are typed, but they are not offered here: this
 * panel is what the demo shows. Hiding them is a presentation rule, not a
 * permission change.
 */
const MVP_ROLES: ReadonlySet<DemoUser['rol']> = new Set([
  'CIUDADANO',
  'CONDUCTOR',
  'ADMIN_CENTRO_AYUDA',
]);

/**
 * Roles the panel offers as ONE profile even though the seed has several. The
 * MVP needs a single help-center administrator, so only the first seeded one is
 * listed; the second account stays in the seed because backend tests use it.
 */
const SINGLE_PROFILE_ROLES: ReadonlySet<DemoUser['rol']> = new Set(['ADMIN_CENTRO_AYUDA']);

/** The profiles the panel lists: MVP roles, one row for the single-profile roles. */
function offeredProfiles(profiles: DemoUser[]): DemoUser[] {
  const seen = new Set<DemoUser['rol']>();
  return profiles.filter((profile) => {
    if (!MVP_ROLES.has(profile.rol)) {
      return false;
    }
    if (SINGLE_PROFILE_ROLES.has(profile.rol)) {
      if (seen.has(profile.rol)) {
        return false;
      }
      seen.add(profile.rol);
    }
    return true;
  });
}

/** Static data: computed once at module load instead of on every render. */
const PROFILE_GROUPS = groupByRole(offeredProfiles(DEMO_USERS));

const ROW_CLASS =
  'flex w-full flex-col gap-0.5 rounded-nv-md px-2 py-1.5 text-left transition-colors hover:bg-nv-mint focus-visible:ring-2 focus-visible:ring-nv-teal disabled:pointer-events-none disabled:opacity-50';

const TOGGLE_CLASS =
  'flex min-w-0 flex-1 items-center gap-1.5 rounded-nv-md px-2 py-1.5 text-left transition-colors hover:bg-nv-mint focus-visible:ring-2 focus-visible:ring-nv-teal disabled:pointer-events-none disabled:opacity-50';

/** One selectable profile: role, email and what the account does. */
function ProfileRow({
  profile,
  disabled,
  onSelect,
}: {
  profile: DemoUser;
  disabled: boolean;
  onSelect: (profile: DemoUser) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${profile.label}. ${profile.email}. ${profile.descripcion}`}
      onClick={() => onSelect(profile)}
      className={ROW_CLASS}
    >
      <span className="font-medium text-xs text-nv-navy">{profile.label}</span>
      <span className="tabular text-[11px] text-nv-navy-400">{profile.email}</span>
      <span className="text-[11px] text-nv-navy-400">{profile.descripcion}</span>
    </button>
  );
}

interface DemoProfilesPanelProps {
  /** Blocks every row while the form is submitting or the account is locked. */
  disabled?: boolean;
  /** True while the typewriter is filling the form for the selected profile. */
  busy?: boolean;
  /** Selecting a profile only fills the form; the caller still posts /api/v1/sesiones. */
  onSelect: (profile: DemoUser) => void;
}

/**
 * Collapsible list of the seeded demo profiles. It never authenticates by
 * itself: clicking a row asks the page to type the credentials into the real
 * form and submit it, so the server stays the single source of truth.
 */
export function DemoProfilesPanel({
  disabled = false,
  busy = false,
  onSelect,
}: DemoProfilesPanelProps) {
  const [open, setOpen] = useState(true);
  const [expandedRoles, setExpandedRoles] = useState<Record<string, boolean>>({});
  const bodyId = useId();

  const toggleRole = (rol: DemoUser['rol']) => {
    setExpandedRoles((current) => ({ ...current, [rol]: !current[rol] }));
  };

  return (
    <div
      aria-busy={busy}
      className="w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-nv-lg border border-nv-line bg-white text-nv-navy shadow-nv-card"
    >
      <div className="flex items-center gap-0.5 p-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className={TOGGLE_CLASS}
        >
          <Users className="size-3.5 shrink-0 text-nv-navy-400" aria-hidden />
          <span className="nv-label truncate text-nv-navy-400">Perfiles demo</span>
          {busy && (
            <span role="status" className="truncate text-[10px] text-nv-navy-400">
              Rellenando…
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              'ml-auto size-3.5 shrink-0 text-nv-navy-400 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </div>

      {open && (
        <div
          id={bodyId}
          className="flex max-h-[min(62dvh,28rem)] flex-col gap-0.5 overflow-y-auto border-nv-line border-t p-1"
        >
          {PROFILE_GROUPS.map((group) => {
            const [first] = group.profiles;
            if (group.profiles.length === 1) {
              return (
                <ProfileRow
                  key={first.email}
                  profile={first}
                  disabled={disabled}
                  onSelect={onSelect}
                />
              );
            }

            const groupOpen = expandedRoles[group.rol] ?? false;
            const groupId = `${bodyId}-${group.rol}`;
            return (
              <div key={group.rol} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  aria-expanded={groupOpen}
                  aria-controls={groupId}
                  onClick={() => toggleRole(group.rol)}
                  className={ROW_CLASS}
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-3.5 shrink-0 text-nv-navy-400 transition-transform',
                        groupOpen && 'rotate-90',
                      )}
                    />
                    <span className="font-medium text-xs text-nv-navy">
                      {first.groupLabel ?? first.label}
                    </span>
                    <span className="tabular text-[11px] text-nv-navy-400">
                      ({group.profiles.length})
                    </span>
                  </span>
                </button>
                {groupOpen && (
                  <div id={groupId} className="flex flex-col gap-0.5 pl-3">
                    {group.profiles.map((profile) => (
                      <ProfileRow
                        key={profile.email}
                        profile={profile}
                        disabled={disabled}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
