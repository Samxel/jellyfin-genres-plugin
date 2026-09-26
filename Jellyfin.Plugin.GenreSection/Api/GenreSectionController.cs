using System;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Jellyfin.Plugin.GenreSection.Configuration;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.GenreSection.Api;

/// <summary>
/// API endpoints used by the web client script and the configuration page.
/// </summary>
[ApiController]
[Route("GenreSection")]
public partial class GenreSectionController : ControllerBase
{
    private const long MaxImageSize = 10 * 1024 * 1024;

    private readonly IServerConfigurationManager _serverConfigurationManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="GenreSectionController"/> class.
    /// </summary>
    /// <param name="serverConfigurationManager">The server configuration manager.</param>
    public GenreSectionController(IServerConfigurationManager serverConfigurationManager)
    {
        _serverConfigurationManager = serverConfigurationManager;
    }

    /// <summary>
    /// Gets the client script that renders the genre section.
    /// </summary>
    /// <returns>The JavaScript file.</returns>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public ActionResult GetClientScript()
    {
        var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(typeof(Plugin).Namespace + ".Web.genreSection.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript; charset=utf-8");
    }

    /// <summary>
    /// Gets the settings needed by the client to render the section.
    /// </summary>
    /// <returns>The client settings.</returns>
    [HttpGet("Settings")]
    [Authorize]
    [Produces(MediaTypeNames.Application.Json)]
    public ActionResult<ClientSettings> GetSettings()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return new ClientSettings
        {
            Enabled = config.Enabled,
            SectionTitle = config.SectionTitle,
            Position = config.Position.ToString(),
            PositionIndex = config.PositionIndex,
            SelectionMode = config.SelectionMode.ToString(),
            LibraryId = config.LibraryId,
            MaxGenres = config.MaxGenres,
            MinMovieCount = config.MinMovieCount,
            RandomDefaultThumbs = config.RandomDefaultThumbs,
            ShowGenreName = config.ShowGenreName,
            Language = string.IsNullOrWhiteSpace(config.Language)
                ? _serverConfigurationManager.Configuration.UICulture ?? "en-US"
                : config.Language,
            Genres = config.Genres.Select(g => new ClientGenre
            {
                Name = g.Name,
                Enabled = g.Enabled,
                DisplayName = g.DisplayName,
                ImageUrl = !string.IsNullOrEmpty(g.ImageFile)
                    ? "GenreSection/Images/" + Uri.EscapeDataString(g.ImageFile)
                    : g.ImageUrl
            }).ToArray()
        };
    }

    /// <summary>
    /// Gets an uploaded genre thumbnail.
    /// </summary>
    /// <param name="fileName">The file name.</param>
    /// <returns>The image.</returns>
    [HttpGet("Images/{fileName}")]
    [AllowAnonymous]
    public ActionResult GetImage([FromRoute] string fileName)
    {
        var path = GetImagePath(fileName);
        if (path is null || !System.IO.File.Exists(path))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return PhysicalFile(path, GetContentType(Path.GetExtension(path)));
    }

    /// <summary>
    /// Uploads a genre thumbnail. The request body is the raw image.
    /// </summary>
    /// <param name="genre">The genre the image belongs to (only used for the file name).</param>
    /// <returns>The stored file name.</returns>
    [HttpPost("Images")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [RequestSizeLimit(MaxImageSize)]
    public async Task<ActionResult<string>> UploadImage([FromQuery] string genre)
    {
        var extension = Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant() switch
        {
            "image/jpeg" or "image/jpg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => null
        };
        if (extension is null)
        {
            return BadRequest("Unsupported image type.");
        }

        var slug = SlugRegex().Replace(genre ?? string.Empty, "-").Trim('-').ToLowerInvariant();
        if (slug.Length == 0)
        {
            slug = "genre";
        }
        else if (slug.Length > 40)
        {
            slug = slug[..40];
        }

        var fileName = slug + "-" + Guid.NewGuid().ToString("N")[..8] + extension;
        var dir = GetImageDirectory();
        Directory.CreateDirectory(dir);

        var fs = new FileStream(Path.Combine(dir, fileName), FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
        await using (fs.ConfigureAwait(false))
        {
            await Request.Body.CopyToAsync(fs).ConfigureAwait(false);
            if (fs.Length == 0)
            {
                fs.Close();
                System.IO.File.Delete(Path.Combine(dir, fileName));
                return BadRequest("Empty body.");
            }
        }

        return fileName;
    }

    /// <summary>
    /// Deletes an uploaded genre thumbnail.
    /// </summary>
    /// <param name="fileName">The file name.</param>
    /// <returns>No content.</returns>
    [HttpDelete("Images/{fileName}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult DeleteImage([FromRoute] string fileName)
    {
        var path = GetImagePath(fileName);
        if (path is null)
        {
            return BadRequest();
        }

        if (System.IO.File.Exists(path))
        {
            System.IO.File.Delete(path);
        }

        return NoContent();
    }

    /// <summary>
    /// Gets the directory uploaded images are stored in.
    /// </summary>
    /// <returns>The directory path.</returns>
    internal static string GetImageDirectory()
        => Path.Combine(Plugin.Instance?.DataFolderPath ?? Path.GetTempPath(), "images");

    private static string? GetImagePath(string fileName)
    {
        if (string.IsNullOrEmpty(fileName) || !FileNameRegex().IsMatch(fileName) || fileName.Contains("..", StringComparison.Ordinal))
        {
            return null;
        }

        return Path.Combine(GetImageDirectory(), fileName);
    }

    private static string GetContentType(string extension) => extension.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "image/jpeg"
    };

    [GeneratedRegex("[^a-zA-Z0-9]+")]
    private static partial Regex SlugRegex();

    [GeneratedRegex("^[a-zA-Z0-9_.-]+$")]
    private static partial Regex FileNameRegex();
}
