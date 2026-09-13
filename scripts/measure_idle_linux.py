#!/usr/bin/env python3
"""Measure dopagaki-board idle CPU and memory on Linux.

This intentionally uses only the Python standard library and /proc. It measures
one root process plus its recursive descendants so WebKit subprocesses are not
silently omitted.

CPU percentage follows the usual Unix convention: one fully busy logical CPU
is 100%, so a multi-process tree can exceed 100%.

RSS is summed across the process tree for a conservative footprint figure.
When /proc/<pid>/smaps_rollup is readable, PSS is reported as a more realistic
shared-memory-aware companion metric.
"""

from __future__ import annotations

import argparse
import csv
import os
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PROC = Path("/proc")
CLOCK_TICKS = os.sysconf("SC_CLK_TCK")
PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")
MIB = 1024 * 1024


@dataclass(frozen=True)
class ProcessInfo:
    pid: int
    ppid: int
    cpu_ticks: int
    rss_bytes: int
    name: str


@dataclass(frozen=True)
class TreeSample:
    timestamp: float
    process_count: int
    total_ticks: int
    ticks_by_pid: dict[int, int]
    rss_bytes: int
    pss_bytes: int | None
    names: tuple[str, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sample CPU/RSS/PSS for a Linux process tree during idle."
    )
    parser.add_argument(
        "--pid",
        required=True,
        type=int,
        help="PID of the dopagaki-board root process (usually the release binary).",
    )
    parser.add_argument(
        "--settle",
        type=float,
        default=60.0,
        help="Seconds to wait before sampling (default: 60).",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=300.0,
        help="Sampling duration in seconds (default: 300).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Sampling interval in seconds (default: 1).",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Optional path for raw sample CSV output.",
    )
    args = parser.parse_args()

    if args.pid <= 0:
        parser.error("--pid must be positive")
    if args.settle < 0:
        parser.error("--settle must be >= 0")
    if args.duration <= 0:
        parser.error("--duration must be > 0")
    if args.interval <= 0:
        parser.error("--interval must be > 0")
    return args


def read_process(pid: int) -> ProcessInfo | None:
    try:
        stat_text = (PROC / str(pid) / "stat").read_text()
        # comm (field 2) may contain spaces and parentheses. Split after its
        # final closing parenthesis instead of using a naive whitespace split.
        close = stat_text.rfind(")")
        if close < 0:
            return None
        name = stat_text[stat_text.find("(") + 1 : close]
        fields = stat_text[close + 2 :].split()
        # fields[0] is stat field 3 (state), so these offsets are deliberate.
        ppid = int(fields[1])
        cpu_ticks = int(fields[11]) + int(fields[12])  # utime + stime

        statm = (PROC / str(pid) / "statm").read_text().split()
        rss_bytes = int(statm[1]) * PAGE_SIZE
        return ProcessInfo(pid, ppid, cpu_ticks, rss_bytes, name)
    except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError, IndexError):
        # Processes can exit while /proc is being scanned.
        return None


def scan_processes() -> dict[int, ProcessInfo]:
    result: dict[int, ProcessInfo] = {}
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        info = read_process(int(entry.name))
        if info is not None:
            result[info.pid] = info
    return result


def process_tree(root_pid: int, processes: dict[int, ProcessInfo]) -> list[ProcessInfo]:
    if root_pid not in processes:
        raise RuntimeError(f"root PID {root_pid} is not running")

    children: dict[int, list[int]] = {}
    for info in processes.values():
        children.setdefault(info.ppid, []).append(info.pid)

    selected: list[ProcessInfo] = []
    stack = [root_pid]
    seen: set[int] = set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        info = processes.get(pid)
        if info is None:
            continue
        selected.append(info)
        stack.extend(children.get(pid, ()))
    return selected


def read_pss_bytes(pid: int) -> int | None:
    try:
        with (PROC / str(pid) / "smaps_rollup").open() as handle:
            for line in handle:
                if line.startswith("Pss:"):
                    # Linux reports smaps sizes in KiB.
                    return int(line.split()[1]) * 1024
    except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError, IndexError):
        return None
    return None


def capture(root_pid: int) -> TreeSample:
    processes = scan_processes()
    tree = process_tree(root_pid, processes)
    pss_values = [read_pss_bytes(info.pid) for info in tree]
    pss_known = [value for value in pss_values if value is not None]
    pss_bytes = sum(pss_known) if len(pss_known) == len(tree) else None
    ticks_by_pid = {info.pid: info.cpu_ticks for info in tree}
    return TreeSample(
        timestamp=time.monotonic(),
        process_count=len(tree),
        total_ticks=sum(ticks_by_pid.values()),
        ticks_by_pid=ticks_by_pid,
        rss_bytes=sum(info.rss_bytes for info in tree),
        pss_bytes=pss_bytes,
        names=tuple(sorted({info.name for info in tree})),
    )


def cpu_percent(previous: TreeSample, current: TreeSample) -> float:
    elapsed = current.timestamp - previous.timestamp
    if elapsed <= 0:
        return 0.0

    delta_ticks = 0
    for pid, ticks in current.ticks_by_pid.items():
        old_ticks = previous.ticks_by_pid.get(pid)
        if old_ticks is None:
            # A newly observed child likely started during this interval. Count
            # its lifetime ticks rather than silently ignoring the new work.
            delta_ticks += ticks
        elif ticks >= old_ticks:
            delta_ticks += ticks - old_ticks

    return (delta_ticks / CLOCK_TICKS) / elapsed * 100.0


def mean(values: Iterable[float]) -> float:
    values = list(values)
    return statistics.fmean(values) if values else float("nan")


def mib(value: int | float) -> float:
    return float(value) / MIB


def main() -> int:
    args = parse_args()
    if not (PROC / str(args.pid)).exists():
        print(f"error: PID {args.pid} does not exist", file=sys.stderr)
        return 2

    print(
        f"settling for {args.settle:.1f}s; keep dopagaki-board in Idle and do not interact"
    )
    time.sleep(args.settle)

    try:
        previous = capture(args.pid)
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    start = previous.timestamp
    rows: list[dict[str, float | int | str]] = []
    names_seen = set(previous.names)

    csv_handle = None
    writer = None
    try:
        if args.csv is not None:
            args.csv.parent.mkdir(parents=True, exist_ok=True)
            csv_handle = args.csv.open("w", newline="")
            writer = csv.DictWriter(
                csv_handle,
                fieldnames=[
                    "elapsed_s",
                    "process_count",
                    "cpu_percent",
                    "rss_mib",
                    "pss_mib",
                ],
            )
            writer.writeheader()

        deadline = start + args.duration
        while True:
            sleep_for = min(args.interval, max(0.0, deadline - time.monotonic()))
            if sleep_for <= 0:
                break
            time.sleep(sleep_for)
            try:
                current = capture(args.pid)
            except RuntimeError as error:
                print(f"error: {error}", file=sys.stderr)
                return 2

            names_seen.update(current.names)
            row: dict[str, float | int | str] = {
                "elapsed_s": round(current.timestamp - start, 3),
                "process_count": current.process_count,
                "cpu_percent": cpu_percent(previous, current),
                "rss_mib": mib(current.rss_bytes),
                "pss_mib": "" if current.pss_bytes is None else mib(current.pss_bytes),
            }
            rows.append(row)
            if writer is not None:
                writer.writerow(row)
                csv_handle.flush()
            previous = current

            if current.timestamp >= deadline:
                break
    except KeyboardInterrupt:
        print("\ninterrupted; summarizing collected samples", file=sys.stderr)
    finally:
        if csv_handle is not None:
            csv_handle.close()

    if not rows:
        print("error: no samples collected", file=sys.stderr)
        return 2

    cpu = [float(row["cpu_percent"]) for row in rows]
    rss = [float(row["rss_mib"]) for row in rows]
    pss = [float(row["pss_mib"]) for row in rows if row["pss_mib"] != ""]
    process_counts = [int(row["process_count"]) for row in rows]

    print("\nIdle process-tree summary")
    print(f"samples: {len(rows)}")
    print(f"observed processes: {min(process_counts)}..{max(process_counts)}")
    print(f"process names: {', '.join(sorted(names_seen))}")
    print(f"CPU mean: {mean(cpu):.3f}%")
    print(f"CPU max: {max(cpu):.3f}%")
    print(f"RSS mean: {mean(rss):.2f} MiB")
    print(f"RSS median: {statistics.median(rss):.2f} MiB")
    print(f"RSS max: {max(rss):.2f} MiB")
    if len(pss) == len(rows):
        print(f"PSS mean: {mean(pss):.2f} MiB")
        print(f"PSS median: {statistics.median(pss):.2f} MiB")
        print(f"PSS max: {max(pss):.2f} MiB")
    else:
        print("PSS: unavailable for one or more process samples")
    if args.csv is not None:
        print(f"raw CSV: {args.csv}")

    print(
        "note: very short-lived children can exit between /proc samples; if churn is visible, rerun with a shorter --interval"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
