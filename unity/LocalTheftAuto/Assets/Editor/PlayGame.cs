/* Command-line "open editor and start playing" entry point:
   Unity -projectPath <project> -executeMethod PlayGame.Enter
   Opens the (GUI) editor and enters play mode once loading finishes. */
using UnityEditor;

public static class PlayGame
{
    public static void Enter()
    {
        // Delay one tick so the editor finishes initializing before the
        // play-mode state change is requested.
        EditorApplication.delayCall += () =>
        {
            if (!EditorApplication.isPlayingOrWillChangePlaymode)
                EditorApplication.EnterPlaymode();
        };
    }
}
