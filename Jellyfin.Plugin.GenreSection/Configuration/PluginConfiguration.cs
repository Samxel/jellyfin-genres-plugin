using System.Diagnostics.CodeAnalysis;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.GenreSection.Configuration;

/// <summary>
/// Which genres are shown in the section.
/// </summary>
public enum GenreSelectionMode
{
    /// <summary>
    /// Show every movie genre of the library (sorted by name).
    /// </summary>
    All,

    /// <summary>
    /// Show only the genres enabled in <see cref="PluginConfiguration.Genres"/>, in that order.
    /// </summary>
    Selected
}

/// <summary>
/// Where the section is placed on the home screen.
/// </summary>
public enum SectionPosition
{
    /// <summary>
    /// Above all other home sections.
    /// </summary>
    Top,

    /// <summary>
    /// After the n-th home section (see <see cref="PluginConfiguration.PositionIndex"/>).
    /// </summary>
    AfterSection,

    /// <summary>
    /// Below all other home sections.
    /// </summary>
    Bottom
}

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the section is shown.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the client script is injected into the web client automatically.
    /// </summary>
    public bool InjectClientScript { get; set; } = true;

    /// <summary>
    /// Gets or sets the section title.
    /// </summary>
    public string SectionTitle { get; set; } = "Genres";

    /// <summary>
    /// Gets or sets the section position.
    /// </summary>
    public SectionPosition Position { get; set; } = SectionPosition.Top;

    /// <summary>
    /// Gets or sets the index used with <see cref="SectionPosition.AfterSection"/>.
    /// </summary>
    public int PositionIndex { get; set; } = 1;

    /// <summary>
    /// Gets or sets the genre selection mode.
    /// </summary>
    public GenreSelectionMode SelectionMode { get; set; } = GenreSelectionMode.All;

    /// <summary>
    /// Gets or sets the movie library the genre links are restricted to. Empty = all movie libraries.
    /// </summary>
    public string LibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the maximum number of genres (0 = unlimited).
    /// </summary>
    public int MaxGenres { get; set; }

    /// <summary>
    /// Gets or sets the minimum number of movies a genre needs to be shown in <see cref="GenreSelectionMode.All"/> mode.
    /// </summary>
    public int MinMovieCount { get; set; } = 1;

    /// <summary>
    /// Gets or sets a value indicating whether the default thumbnail picks a random movie backdrop on each load.
    /// </summary>
    public bool RandomDefaultThumbs { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the genre name and movie count are shown below the thumbnail.
    /// </summary>
    public bool ShowGenreName { get; set; } = true;

    /// <summary>
    /// Gets or sets how the genre name is drawn on the thumbnail: "Center" (large, like the library tiles),
    /// "Bottom" (the web client's small caption bar) or "None".
    /// </summary>
    public string NameOnImage { get; set; } = "Center";

    /// <summary>
    /// Gets or sets the language of the section labels (e.g. "en", "de"). Empty = server language.
    /// </summary>
    public string Language { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the per-genre settings.
    /// </summary>
    [SuppressMessage("Performance", "CA1819:Properties should not return arrays", Justification = "Required for XML serialization.")]
    public GenreEntry[] Genres { get; set; } = [];
}
