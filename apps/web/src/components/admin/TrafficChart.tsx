import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Daily traffic, as one area chart of visits with unique visitors beneath it.
 *
 * Replaces a hand-rolled row of `div`s whose height was a percentage of the peak. That read fine
 * for one series and could not carry a second without a legend, could not show a value on hover
 * beyond a native `title`, and reflowed the whole row on every resize because the bar widths were
 * a flex fraction. A real chart library gives the two series, the axis ticks and the tooltip for
 * free, and its SVG scales to the container rather than the container chasing the bars.
 *
 * The colours come from the app's own tokens (`--lp-accent-red` for the accent series), so the
 * chart follows the light/dark theme like every other surface. Recharts needs the colours as
 * values rather than CSS variables in some props, so the accent is read once from the document and
 * passed as a plain string; the muted series is a translucent black/white that reads on both
 * backgrounds.
 */
export interface TrafficPoint {
  date: string;
  visits: number;
  unique: number;
}

/** A date the axis can read: "Oct 22" rather than an ISO string. */
function shortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  // Fewer ticks on a wide window, so the labels do not collide into an unreadable smear.
  const tickInterval = data.length > 20 ? Math.ceil(data.length / 8) - 1 : 0;

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="adminVisitsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--lp-accent-red)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--lp-accent-red)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="adminUniqueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--lp-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            interval={tickInterval}
            tick={{ fill: 'var(--lp-text-faint)', fontSize: 11 }}
            stroke="var(--lp-line)"
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            width={40}
            tick={{ fill: 'var(--lp-text-faint)', fontSize: 11 }}
            stroke="var(--lp-line)"
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(label) => shortDate(String(label))}
            contentStyle={{
              background: 'var(--lp-surface-elevated)',
              border: '1px solid var(--lp-line)',
              borderRadius: 12,
              color: 'var(--lp-text)',
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--lp-text-muted)' }}
          />
          <Area
            type="monotone"
            dataKey="visits"
            name="Visits"
            stroke="var(--lp-accent-red)"
            strokeWidth={2}
            fill="url(#adminVisitsFill)"
          />
          <Area
            type="monotone"
            dataKey="unique"
            name="Unique visitors"
            stroke="var(--lp-text-muted)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="url(#adminUniqueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
