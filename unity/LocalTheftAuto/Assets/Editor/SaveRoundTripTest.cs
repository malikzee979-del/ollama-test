/* Save round-trip regression checks for SaveData (LTA.Core.cs) — the save
   contract every future feature will extend, exercised the same way the
   other Editor harnesses are run (headless -executeMethod, plain bool
   checks, Fail() throws).

   Pins the four guarantees the rest of the backlog builds on:
     1. a fresh SaveData is constructible with valid defaults;
     2. JSON missing fields deserializes WITHOUT throwing and leaves the
        field at its C# default (JsonUtility contract the code relies on);
     3. a pre-progression "old shape" JSON (hand-written, the fields the
        original save shipped) still loads;
     4. serialize→deserialize is identity for every documented field.

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod
     LocalTheftAuto.SaveRoundTripTest.Run
   (Quit code 0 = all checks passed; a Fail prints the failing check and
   exits non-zero through the exception.)
*/
using UnityEngine;
using LocalTheftAuto;

public static class SaveRoundTripTest
{
    static int checksPassed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new System.Exception("SaveRoundTripTest FAIL: " + what);
        checksPassed++;
    }

    public static void Run()
    {
        Fresh_IsValid();
        AbsentFields_DeserializeDefaults();
        OldShape_StillLoads();
        RoundTrip_IsIdentity();
        Debug.Log("SaveRoundTripTest: " + checksPassed + " checks passed");
    }

    /* 1 — the type is usable with nothing set (mirrors SaveGame's
       responsibility: it only ever writes `valid = true` explicitly, but a
       default-constructed instance must not sneak out false-shaped
       guarantees the loader would trust). */
    static void Fresh_IsValid()
    {
        var sd = new SaveData();
        Check(sd.px == 0f && sd.py == 0f && sd.pa == 0f, "fresh px/py/pa default to 0");
        Check(sd.health == 0f, "fresh health defaults to 0");
        Check(sd.ammo == 0 && !sd.hasGun && !sd.ownsSmg && !sd.ownsShotgun,
              "fresh loadout defaults to unarmed");
        Check(sd.weapon == 0, "fresh weapon defaults to WeaponKind.None (0)");
        Check(sd.score == 0 && sd.wanted == 0 && sd.highScore == 0, "fresh counters default to 0");
        Check(sd.valid == false, "fresh valid is false — loaders must not trust an empty shape");
    }

    /* 2 — the contract LoadGame leans on every session: JSON written by an
       OLDER build (fields absent) must deserialize without throwing and
       produce the C# field defaults, not garbage or NaNs. */
    static void AbsentFields_DeserializeDefaults()
    {
        // current shape with the loadout fields omitted entirely
        string json = "{\"px\":12.5,\"py\":-3.0,\"pa\":1.0,\"health\":88.0," +
                      "\"score\":420,\"highScore\":900,\"valid\":true}";
        SaveData sd = null;
        bool threw = false;
        try { sd = JsonUtility.FromJson<SaveData>(json); }
        catch (System.Exception) { threw = true; }
        Check(!threw && sd != null, "partial JSON deserializes without throwing");
        Check(sd.px == 12.5f && sd.py == -3.0f && sd.pa == 1.0f, "present fields round-trip in partial JSON");
        Check(sd.health == 88f, "present health round-trips");
        Check(sd.ammo == 0 && !sd.hasGun, "absent ammo/hasGun arrive at C# defaults");
        Check(sd.ownsSmg == false && sd.ownsShotgun == false, "absent owned-weapons arrive false");
        Check(sd.wanted == 0, "absent wanted arrives 0");
        Check(sd.valid, "valid flag survives partial JSON");

        // null-consistency: empty string is what PlayerPrefs.GetString's default
        // gives when the key has never been written. VERIFIED behavior in
        // Unity 6000.5: FromJson("") returns NULL — which is precisely why
        // LoadGame guards `sd == null || !sd.valid` after its try/catch.
        // (First run of this test assumed an all-defaults instance; the
        // engine disagreed. The loader's guard is the load-bearing behavior.)
        SaveData empty = JsonUtility.FromJson<SaveData>("");
        Check(empty == null, "empty JSON string deserializes to null (loader's null guard is load-bearing)");
    }

    /* 3 — the "old shape": the exact minimal JSON the original save format
       wrote (position + health + score + valid, before gang-wars arsenal
       fields existed). LoadGame's hasGun comment promises this loads as
       pistol ownership at most; here we only pin that deserialization is
       clean and the loader-visible fields behave. */
    static void OldShape_StillLoads()
    {
        string json = "{\"px\":100.0,\"py\":200.0,\"pa\":0.5,\"health\":100.0," +
                      "\"ammo\":0,\"hasGun\":false,\"weapon\":0," +
                      "\"score\":77,\"wanted\":0,\"highScore\":777,\"valid\":true}";
        SaveData sd = null;
        bool threw = false;
        try { sd = JsonUtility.FromJson<SaveData>(json); }
        catch (System.Exception) { threw = true; }
        Check(!threw && sd != null, "old-shape JSON parses without throwing");
        Check(sd.valid, "old-shape valid survives");
        Check(sd.score == 77 && sd.highScore == 777, "old-shape scores round-trip");
        Check(sd.hasGun == false && !sd.ownsSmg && !sd.ownsShotgun,
              "old-shape loadout reads unarmed (loader maps hasGun→pistol when set)");
        Check(sd.px == 100f && sd.py == 200f && sd.pa == 0.5f, "old-shape position round-trips");
    }

    /* 4 — full identity: every documented field set to a distinct non-zero
       value, serialized, deserialized, compared. */
    static void RoundTrip_IsIdentity()
    {
        var src = new SaveData
        {
            px = 33.25f, py = -141.75f, pa = 2.75f,
            health = 66.5f, ammo = 12,
            hasGun = true, ownsSmg = true, ownsShotgun = true,
            weapon = 2,    // an arbitrary in-range WeaponKind value
            score = 4400, wanted = 3, highScore = 9001,
            valid = true
        };
        string json = JsonUtility.ToJson(src);
        var back = JsonUtility.FromJson<SaveData>(json);

        Check(back.px == src.px && back.py == src.py && back.pa == src.pa, "identity: position");
        Check(back.health == src.health && back.ammo == src.ammo, "identity: health/ammo");
        Check(back.hasGun == src.hasGun && back.ownsSmg == src.ownsSmg
              && back.ownsShotgun == src.ownsShotgun, "identity: owned weapons");
        Check(back.weapon == src.weapon, "identity: weapon");
        Check(back.score == src.score && back.wanted == src.wanted
              && back.highScore == src.highScore, "identity: counters");
        Check(back.valid == src.valid, "identity: valid");
    }
}
