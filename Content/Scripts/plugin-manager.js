/**
 * Name: plugin-manager.js
 * Description: Un/install plugins and manage already installed plugins
 * Module.Exports
 *  - List(): Returns a list of available plugin objects
 *  - ShowPluginList(): Opens/Shows a visual menulist with all plugins and their status
 *  - HidePluginList(): Closes/hides a visual menulist with all plugins and their status
 *  - TogglePluginList(): Makes the plugin list visible if it is hidden and hides it if it is visible
 **/

// SEE: https://github.com/ncsoft/Unreal.js-core/blob/master/Source/V8/Private/JavascriptProcess.cpp
// var pluginDir = JavascriptProcess.GetString('ApplicationSettingsDir') + '/SimsDewire-PluginJS/';
var pluginDir = Context.GetDir('GameContent') + '/PluginJS/';
var repoExceptions = ['ExploringSysOps', 'ExploringSysOpsServer']; // The repos that will be ignored as a plugin repo
var gitUrl = 'https://api.github.com/orgs/SIMSDewire/repos';
const network = require('request');

// Compile classes
const uclass = require('uclass')().bind(this,global);

// Style/design of widgets
const UMG = require('UMG');
const instantiator = require('instantiator')

// Help functions to manage plugins
//  FetchList - a list all avaliable and installed plugins
//  Install - install a plugin recieved from fetchList
//  Uninstall - uninstall a plugin recieved form fetchlist
//  IsValid - is a plugin object is valid
var Plugin = {
	FetchList: function () {
		if(!JavascriptLibrary.DirectoryExists(pluginDir))
			JavascriptLibrary.MakeDirectory(pluginDir, true);

		return network('GET', gitUrl).then(function(res) {
			return res
			// Only looks at repositories with default branch == uejs_plugin and the repo cannot be private
			.filter(function(p) {return !p.private && p.default_branch == 'uejs_plugin';})
			.map(function(plugin_info) {
				return new PluginObject(plugin_info);
			});
		});
	},
	// Download the plugin from the repository to the project directory
	Install: function(plugin_info) {
		if(!JavascriptLibrary.DirectoryExists(pluginDir))
			JavascriptLibrary.MakeDirectory(pluginDir, true);

		var gitProcess = JavascriptProcess.Create('git', 'clone https://github.com/' + plugin_info.packageSlug + ' ' + plugin_info.packageSlug.replace(/\//gm, '_'),
								false,	// bLaunchDetached
								false,	// bLaunchHidden
								false,	// bLaunchReallyHidden
								0,		// PriorityModifier
								pluginDir, // WD
								false	// bUsePipe
		);
		return Promise.resolve({ 
			then: function(resolve, reject) {
				gitProcess.Wait();
				var code;
				var success = gitProcess.GetReturnCode(code);
				if(success) return resolve(code, plugin_info);
				return reject(code, plugin_info);
			}
		});
	},
	// Removes the plugin from the project directory
	UnInstall: function(plugin_info) {
		if(!JavascriptLibrary.DirectoryExists(pluginDir))
			JavascriptLibrary.MakeDirectory(pluginDir, true);
		
				return new Promise(function(resolve,reject) {
						if (JavascriptLibrary.DirectoryExists(plugin_info.packageDir) &&
							JavascriptLibrary.DeleteDirectory(plugin_info.packageDir,true,true)) {
								resolve();
						} else {
								reject(new Error('delete failed'), plugin_info);
						}
				});
	},
	IsValid: function(plugin_info) {
		if(!JavascriptLibrary.DirectoryExists(plugin_info.packageDir))
			return false;
		var pluginContent = Context.ReadDirectory(plugin_info.packageDir);
		var filesForValidPlugin = ['index.js'];
		for(var j in pluginContent.OutItems) {
			var fileIndex = filesForValidPlugin.indexOf(pluginContent.OutItems[j].Name);
			if(fileIndex > -1)
				filesForValidPlugin.splice(fileIndex, 1);
		}
		return filesForValidPlugin.length == 0;
	}
};

/**
 * An object that is verified as a plugin and can be instantiated in the scene
 */
var PluginObject = function(plugin_info) {
	var self = this;
	try {
		const packageUrl = plugin_info.html_url;
		const packageSlug = plugin_info.full_name.toLowerCase();
		self.name 			= plugin_info.full_name.split('/', 2)[1];
		self.packageUrl		= packageUrl;
		self.packageSlug	= packageSlug;
		self.packageDir		= pluginDir + packageSlug.replace(/\//gm, '_');
		self.installed		= JavascriptLibrary.DirectoryExists(self.packageDir);
	} catch(e) {
		console.error(e);
		throw new Error("Something happend");
	}
	self.Install = function() {
		return Plugin.Install(self);
	};
	self.UnInstall = function() {
		return Plugin.UnInstall(self);
	};
	self.IsValid = function() {
		return Plugin.IsValid(self);
	};
}

/**
 * PackageListView 
 * Displays a graphical UMG list of all plugins available 
 * and if they are installed on this system or not
 */
class PackageListViewWidget_S extends JavascriptWidget {
	ctor() {
		var root = {};
		var throbber; // Loader icon local variable

		var design = UMG.div({},
			UMG.text({}, "Plugin list"),
			UMG(JavascriptListView,{
				ItemHeight:20,
				// OnContextMenuOpening: packages.contextMenu,
				// This function is called when a row is added in the Javascript list-view
				OnGenerateRowEvent: function(item,column) {
					const isName = (column == 'Name');
					var itemUMG = UMG.text({}, (column != '_' ? column : ''));
					if(typeof item != "undefined") {
						if(column == 'Name')
							itemUMG = UMG.text({}, item.package.name);
						else if(column == 'Status')
							itemUMG = UMG.text({}, item.package.installed ? "Installed" : "Uninstalled");
						else 
							itemUMG = UMG(Button, {
								OnClicked: function() {
									console.log("button clicked");
								}
							}, UMG.text({}, "Install this plugin"));
					}
					return instantiator(itemUMG);
				},
				Columns: [
					{
						Id: 'Name',
						Width: 0.5
					},
					{
						Id: 'Status',
						Width: 0.25
					},
					{
						Id: '_',
						Width: 0.25
					}
				],
				$link:elem => {
					elem.JavascriptContext = Context
					elem.alive = true
					// TODO: Figure out what this code snippet does and document it!
					// elem.proxy = {
					//     OnDoubleClick : item => item.actions.install(),
					//     OnSelectionChanged: item => packages.setCurrent(item)
					// }
					function packageToObject(p) {
						var o = new JavascriptObject();
						o.package = p;
						return o;
					}
					function refresh() {
						throbber.SetVisibility('Visible')
						Plugin.FetchList().then(function(packages) {
							if (!elem.alive) throw new Error("interrupted")
							// root.Items = ... is necessary to keep these items not to be collected by GC
							// because JavascriptObject has a JS object attached.
							try {
								root.Items = elem.Items = packages.map(x => packageToObject(x));
								throbber.SetVisibility('Hidden');
								elem.RequestListRefresh();
							} catch(e) {// This try catch block is here to prevent unreal to crash if an error occurres
								console.log(":(", e)
							}
						})
					}

					process.nextTick(refresh)
					elem.refresh = refresh

				},
				$unlink: function(elem) {
					elem.alive = false;
				}
			}),
			UMG(Throbber,{
				'Slot.HorizontalAlignment':'HAlign_Center',
				$link: function(elem) {
					throbber = elem;
				},
				$unlink: function(elem) {
					throbber = undefined;
				}
			})
		)
		var page = instantiator(design)
		this.SetRootWidget(page);
	}
}
/**
 * WidgetHandler 
 * Loads PackageListView into a 3D actor mesh in GWorld
 * NOTE: Always inherit from a base class created in unreal engine i.e blueprint or c++ class we created as middleman
 */

class WidgetHandler_S extends Blueprint.Load('/Game/BlueprintScripts/ScriptManager').GeneratedClass {
	properties() {
		this.MenuWidget/*EditAnyWhere+/Script/UMG.WidgetComponent*/;
	}
	ctor() {
		this.MenuWidget = WidgetComponent.CreateDefaultSubobject("WidgetComponent0");
		this.SetRootComponent(this.MenuWidget);
		var widget = new PackageListViewWidget();
		this.MenuWidget.SetDrawSize({X: 800, Y: 600});
		this.MenuWidget.SetWidget(widget);
	}
	dtor() {
	}
	ReceiveBeginPlay() {
		super.ReceiveBeginPlay();
	}
	/**
	 * Search plugin folder after valid plugins and return the names of the plugins found
	 */
	GetInstalledPlugins() {
		var plugins = [];
		var dirs = Context.ReadDirectory(this.pluginDir);
		for(var i in dirs.OutItems) {
			var OutItem = dirs.OutItems[i];
			if(OutItem.IsDirectory) {
				if(Plugin.isValid(OutItem.Name)) {
					var file = OutItem.Name;
					plugins.push(file);
				}
			}
		}
		return plugins;
	}
}

// Compilation stage
var PackageListViewWidget = uclass(PackageListViewWidget_S);
var WidgetHandler = uclass(WidgetHandler_S);

var menuInstance = undefined;
// Make certain parts of this file public
module.exports = {};
module.exports.List = function(ops) {
	return Plugin.FetchList();
};
module.exports.ShowPluginList = function() {
	if(typeof menuInstance === "object") return false;
	const player = GWorld.GetPlayerController(0);
	var location = player.GetActorLocation();
	location.X += 200;
	var forward = player.GetActorForwardVector().Multiply_VectorFloat(600);
	var menuposition = location.Add_VectorVector(forward);
	var menurotation = forward.MakeRotFromX();
	menurotation.Yaw += 200;
	var widget = new WidgetHandler(GWorld, menuposition, menurotation);
	menuInstance = widget;
	return true;
};
module.exports.HidePluginList = function () {
	if(typeof menuInstance !== "object") return false;
	menuInstance.DestroyActor();
	menuInstance = undefined;
	return true;
}

module.exports.TogglePluginList = function () {
	if(!module.exports.HidePluginList())
		return module.exports.ShowPluginList();
	return true;
}