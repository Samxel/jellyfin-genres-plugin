using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.GenreSection.Web;

/// <summary>
/// Injects the genre section client script into the web client's index.html.
/// </summary>
public class ScriptInjectionMiddleware
{
    /// <summary>
    /// Marker attribute on the injected script tag.
    /// </summary>
    internal const string Marker = "data-plugin=\"GenreSection\"";

    private const string ScriptTag = "<script " + Marker + " defer src=\"../GenreSection/ClientScript\"></script>";

    private readonly RequestDelegate _next;
    private readonly ILogger<ScriptInjectionMiddleware> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ScriptInjectionMiddleware"/> class.
    /// </summary>
    /// <param name="next">The next delegate.</param>
    /// <param name="logger">The logger.</param>
    public ScriptInjectionMiddleware(RequestDelegate next, ILogger<ScriptInjectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    /// <summary>
    /// Handles a request.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <returns>A task.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (!IsIndexRequest(context.Request) || !(Plugin.Instance?.Configuration.InjectClientScript ?? false))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // Make sure we get an uncompressed, full body we can modify.
        context.Request.Headers.Remove("Accept-Encoding");
        context.Request.Headers.Remove("If-None-Match");
        context.Request.Headers.Remove("If-Modified-Since");

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await _next(context).ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        buffer.Position = 0;
        var contentType = context.Response.ContentType ?? string.Empty;
        if (context.Response.StatusCode != StatusCodes.Status200OK
            || !contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase)
            || context.Response.Headers.ContentEncoding.Count > 0)
        {
            await buffer.CopyToAsync(originalBody).ConfigureAwait(false);
            return;
        }

        string html;
        using (var reader = new StreamReader(buffer, Encoding.UTF8, false, 4096, true))
        {
            html = await reader.ReadToEndAsync().ConfigureAwait(false);
        }

        if (!html.Contains(Marker, StringComparison.Ordinal))
        {
            var idx = html.LastIndexOf("</head>", StringComparison.OrdinalIgnoreCase);
            if (idx < 0)
            {
                idx = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            }

            if (idx >= 0)
            {
                html = html.Insert(idx, ScriptTag);
            }
            else
            {
                _logger.LogWarning("GenreSection: could not find </head> in index.html, script not injected");
            }
        }

        var bytes = Encoding.UTF8.GetBytes(html);
        context.Response.Headers.ETag = default;
        context.Response.Headers.LastModified = default;
        context.Response.ContentLength = bytes.Length;
        await originalBody.WriteAsync(bytes).ConfigureAwait(false);
    }

    private static bool IsIndexRequest(HttpRequest request)
    {
        if (!HttpMethods.IsGet(request.Method))
        {
            return false;
        }

        var path = request.Path.Value ?? string.Empty;
        return path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase);
    }
}
