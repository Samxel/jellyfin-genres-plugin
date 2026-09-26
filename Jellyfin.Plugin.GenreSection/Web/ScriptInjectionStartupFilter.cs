using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.GenreSection.Web;

/// <summary>
/// Adds <see cref="ScriptInjectionMiddleware"/> in front of the server pipeline.
/// </summary>
public class ScriptInjectionStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.UseMiddleware<ScriptInjectionMiddleware>();
            next(app);
        };
    }
}
