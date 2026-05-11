import { CalendarDays } from "lucide-react";
import { buildPressureCalendar } from "../lib/pressureCalendar";
import type { TelemetryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PressureCalendarPanel({ telemetry }: { telemetry: TelemetryResponse | null }) {
  const calendar = buildPressureCalendar(telemetry?.samples ?? []);
  return (
    <article className="pressure-calendar-panel">
      <div className="pressure-calendar-head">
        <SectionTitle icon={<CalendarDays size={18} />} title="Pressure Calendar" />
        <span>{calendar.totalSamples} samples</span>
      </div>
      {calendar.totalSamples ? (
        <>
          <dl className="pressure-calendar-summary">
            <div>
              <dt>lightest</dt>
              <dd>{calendar.quiet?.label ?? "n/a"}</dd>
            </div>
            <div>
              <dt>heaviest</dt>
              <dd>{calendar.hot?.label ?? "n/a"}</dd>
            </div>
          </dl>
          <div className="pressure-calendar-grid" aria-label="Queue pressure by day and time">
            <div className="pressure-calendar-axis" aria-hidden="true">
              <span />
              {["00", "04", "08", "12", "16", "20"].map((hour) => <span key={hour}>{hour}</span>)}
            </div>
            {calendar.days.map((day) => (
              <div className="pressure-day-row" key={day.day}>
                <strong>{day.day}</strong>
                {day.slots.map((slot) => (
                  <i
                    key={slot.key}
                    className={`tone-${slot.samples ? slot.tone : "empty"}`}
                    title={`${slot.label}: ${slot.samples} samples, ${slot.pending} pending, ${slot.gpuFree} GPU free, pressure ${slot.pressure}%`}
                  />
                ))}
              </div>
            ))}
          </div>
          <p>{calendar.summary}</p>
        </>
      ) : (
        <EmptyState text={calendar.summary} />
      )}
    </article>
  );
}
