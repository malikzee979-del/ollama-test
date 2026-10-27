/* ==========================================================================
   Local Theft Auto — uniform spatial hash over the 2D JS-plane world.

   Several sim systems used to answer "who is within R of this entity?" by
   scanning the full car/ped list every frame: traffic probing was O(C^2),
   ped near-miss O(P*C), crowd-scare O(P^2) and gang targeting O(G^2). At
   today's counts (95 traffic + 55 parked cars, 180+ peds) that was
   tolerable, but it capped how much bigger the city could grow.

   SpatialGrid is a counting-sort uniform grid rebuilt LAZILY — once per
   game-clock step (d.State.Time), on the first query — so both GameLoop and
   the headless Editor sim tests (which drive Systems.* directly with their
   own GameData) get fresh data with no wiring at the call sites. Queries
   are broad-phase: they return candidate indices whose CELL overlaps the
   query circle; callers keep their exact per-entity distance checks, so
   behaviour is identical to the old full scans.

   Entities are addressed by their index in GameData.Cars/Peds. Neither list
   is ever removed from mid-frame (dead peds stay flagged, wrecked cars stay
   listed), so indices remain valid for the whole step.
   ========================================================================== */
using System;
using System.Collections.Generic;
using UnityEngine;

namespace LocalTheftAuto
{
    public class SpatialGrid<T> where T : class
    {
        // 512px cells: the largest per-frame query radius is the gang sight
        // range (300px), so every query touches at most a 3x3 cell
        // neighbourhood, and the whole 6912px city is just 14x14 cells.
        public const int CellSize = 512;
        static readonly int Axis = (Cfg.World * Cfg.Tile + CellSize - 1) / CellSize;
        static readonly int CellCount = Axis * Axis;

        readonly Func<T, float> xPos, yPos;
        readonly int[] counts = new int[CellCount];
        readonly int[] starts = new int[CellCount + 1];
        int[] items = new int[0];

        List<T> source;
        GameData builtFor;
        double builtAtTime = double.NaN;

        public SpatialGrid(Func<T, float> xPos, Func<T, float> yPos)
        {
            this.xPos = xPos;
            this.yPos = yPos;
        }

        // Rebuild if the game clock has moved on (or a different GameData
        // asks — the Editor sim tests each run their own world).
        public void EnsureFresh(GameData d, List<T> list)
        {
            if (source == list && builtFor == d && builtAtTime == d.State.Time) return;
            Rebuild(d, list);
        }

        // Broad-phase circle query: clears outIdx, then appends the index of
        // every entity whose cell overlaps the circle at (x,y,r). Callers do
        // the exact per-entity check, exactly as the old full scans did.
        public void QueryFresh(GameData d, List<T> list, float x, float y, float r, List<int> outIdx)
        {
            EnsureFresh(d, list);
            outIdx.Clear();
            if (source == null) return;
            int cx0 = CellIdx(x - r), cx1 = CellIdx(x + r);
            int cy0 = CellIdx(y - r), cy1 = CellIdx(y + r);
            for (int cy = cy0; cy <= cy1; cy++)
            {
                int row = cy * Axis;
                for (int cx = cx0; cx <= cx1; cx++)
                {
                    int cell = row + cx;
                    for (int i = starts[cell]; i < starts[cell + 1]; i++)
                        outIdx.Add(items[i]);
                }
            }
        }

        void Rebuild(GameData d, List<T> list)
        {
            source = list;
            builtFor = d;
            builtAtTime = d.State.Time;

            int n = list.Count;
            if (items.Length < n) items = new int[n];
            for (int i = 0; i < CellCount; i++) counts[i] = 0;
            for (int i = 0; i < n; i++)
            {
                T e = list[i];
                counts[CellIdx(yPos(e)) * Axis + CellIdx(xPos(e))]++;
            }
            int sum = 0;
            for (int i = 0; i < CellCount; i++) { starts[i] = sum; sum += counts[i]; }
            starts[CellCount] = sum;
            for (int i = 0; i < CellCount; i++) counts[i] = starts[i];   // fill cursors
            for (int i = 0; i < n; i++)
            {
                T e = list[i];
                items[counts[CellIdx(yPos(e)) * Axis + CellIdx(xPos(e))]++] = i;
            }
        }

        // world position -> cell index, clamped so entities pushed slightly
        // outside the map edge still land in a border cell
        static int CellIdx(float v)
        {
            int c = Mathf.FloorToInt(v / CellSize);
            if (c < 0) return 0;
            if (c >= Axis) return Axis - 1;
            return c;
        }
    }

    public static class Spatial
    {
        public static readonly SpatialGrid<CarEnt> Cars =
            new SpatialGrid<CarEnt>(e => e.X, e => e.Y);
        public static readonly SpatialGrid<PedEnt> Peds =
            new SpatialGrid<PedEnt>(e => e.X, e => e.Y);
    }
}
