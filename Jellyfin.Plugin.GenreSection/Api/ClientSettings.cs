using System.Diagnostics.CodeAnalysis;

namespace Jellyfin.Plugin.GenreSection.Api;

/// <summary>
/// Settings sent to the web client.
/// </summary>
public class ClientSettings
{
    /// <summary>
    /// Gets or sets a value indicating whether the section is shown.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets the section title.
    /// </summary>
    public string SectionTitle { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the position (Top, AfterSection, Bottom).
    /// </summary>
    public string Position { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the index used with position AfterSection.
    /// </summary>
    public int PositionIndex { get; set; }

    /// <summary>
    /// Gets or sets the selection mode (All, Selected).
    /// </summary>
    public string SelectionMode { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the movie library id (empty = all).
    /// </summary>
    public string LibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the maximum number of genres.
    /// </summary>
    public int MaxGenres { get; set; }

    /// <summary>
    /// Gets or sets the minimum movie count per genre.
    /// </summary>
    public int MinMovieCount { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether default thumbs are random.
    /// </summary>
    public bool RandomDefaultThumbs { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the genre name is drawn on the thumbnail.
    /// </summary>
    public bool ShowGenreName { get; set; }

    /// <summary>
    /// Gets or sets the per-genre settings.
    /// </summary>
    [SuppressMessage("Performance", "CA1819:Properties should not return arrays", Justification = "DTO.")]
    public ClientGenre[] Genres { get; set; } = [];
}

/// <summary>
/// Per-genre settings sent to the web client.
/// </summary>
[SuppressMessage("StyleCop.CSharp.MaintainabilityRules", "SA1402:File may only contain a single type", Justification = "DTO.")]
public class ClientGenre
{
    /// <summary>
    /// Gets or sets the genre name.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the genre is enabled.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets the display name.
    /// </summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the custom thumbnail URL (relative to the server root or absolute).
    /// </summary>
    public string ImageUrl { get; set; } = string.Empty;
}
