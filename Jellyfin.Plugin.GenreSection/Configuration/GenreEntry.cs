namespace Jellyfin.Plugin.GenreSection.Configuration;

/// <summary>
/// Per-genre settings.
/// </summary>
public class GenreEntry
{
    /// <summary>
    /// Gets or sets the genre name (matches the Jellyfin genre name).
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the genre is shown in <see cref="GenreSelectionMode.Selected"/> mode.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets an optional custom label (empty = genre name).
    /// </summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets an optional external image URL used as thumbnail.
    /// </summary>
    public string ImageUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the file name of an uploaded thumbnail in the plugin data folder.
    /// </summary>
    public string ImageFile { get; set; } = string.Empty;
}
