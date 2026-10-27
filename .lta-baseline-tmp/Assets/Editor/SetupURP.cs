/* One-shot editor tooling for the URP migration.

   Phase 1 only: install the Universal Render Pipeline package. The version
   is deliberately NOT pinned — Client.Add with a bare package name resolves
   whatever version this editor considers compatible, which is what we want
   (the public registry endpoint reports a stale "latest" for URP, and the
   editor install carries no version hint to copy).

   Run with:
     Unity -quit -batchmode -projectPath <project> -executeMethod SetupURP.AddPackage
*/
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

public static class SetupURP
{
    public static void AddPackage()
    {
        AddOne("com.unity.render-pipelines.universal");
    }

    static void AddOne(string id)
    {
        Debug.Log("[SetupURP] adding " + id);
        AddRequest req = Client.Add(id);

        // Package Manager requests progress on a background thread, so a
        // spin-wait is safe in batchmode where the editor loop does not tick.
        int guard = 0;
        while (!req.IsCompleted && guard < 60000)
        {
            System.Threading.Thread.Sleep(100);
            guard += 100;
        }

        if (req.Status == StatusCode.Success)
        {
            Debug.Log("[SetupURP] installed " + req.Result.packageId);
        }
        else
        {
            Debug.LogError("[SetupURP] FAILED " + id + ": " +
                           (req.Error != null ? req.Error.message : "timed out"));
            EditorApplication.Exit(1);
        }
    }
}
