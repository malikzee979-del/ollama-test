/* Command-line build entry point:
   Unity -quit -batchmode -projectPath <project> -executeMethod BuildGame.Build
   Produces Builds/LocalTheftAuto.app */
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class BuildGame
{
    public static void Build()
    {
        var options = new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Scenes/Main.unity" },
            locationPathName = "Builds/LocalTheftAuto.app",
            target = BuildTarget.StandaloneOSX,
            options = BuildOptions.None
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        Debug.Log("Build result: " + report.summary.result +
                  " (" + report.summary.totalTime + ", " + report.summary.totalSize + " bytes)");

        if (report.summary.result != BuildResult.Succeeded)
            EditorApplication.Exit(1);
    }
}
