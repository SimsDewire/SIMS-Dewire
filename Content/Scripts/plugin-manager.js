/**
 * Name: plugin-manager.js
 * Description: Un/install plugins and manage already installed plugins
 * Module.Exports
 *  - List(): Returns a list of available plugin objects
 *  - ShowPluginList(): Opens/Shows a visual menulist with all plugins and their status
 *  - HidePluginList(): Closes/hides a visual menulist with all plugins and their status
 *  - TogglePluginList(): Makes the plugin list visible if it is hidden and hides it if it is visible
 **/
"use strict";
// SEE: https://github.com/ncsoft/Unreal.js-core/blob/master/Source/V8/Private/JavascriptProcess.cpp
// var pluginsDir = JavascriptProcess.GetString('ApplicationSettingsDir') + '/SimsDewire-PluginJS/';
// var pluginsDir = Context.GetDir('GameContent') + 'PluginJS/';
var pluginsDir = Context.GetDir('GameSaved') + 'PluginJS/';
// var pluginsDir = '../../Saved/PluginJS';
// var pluginsDir = 'C:/Users/DevGroupDewire/AppData/Roaming/PluginJS';
var repoExceptions = ['ExploringSysOps', 'ExploringSysOpsServer']; // The repos that will be ignored as a plugin repo
var gitUrl = GWorld.ServerIP + '/repos';

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
		if(!JavascriptLibrary.DirectoryExists(pluginsDir))
			JavascriptLibrary.MakeDirectory(pluginsDir, true);

		return network('GET', gitUrl).then(function(res) {
			return res
			.map(function(plugin_info) {
				return new PluginObject(plugin_info);
			});
		}).catch(function(e) {
		      console.log("catch:", e)
		});
	},
	GetPluginActors: function (pluginSlugName) {
		if(pluginSlugName in installedPlugins)
			return installedPlugins[pluginSlugName].getPluginActors();
		return false;
	},
	GetPluginByName: function(pluginName) {

		var pluginRealInfo = undefined;
		for(var i in availablePlugins) {
			if(availablePlugins[i].packageSlug == pluginName) {
				pluginRealInfo = availablePlugins[i];
				break;
			}
		}
		return pluginRealInfo;
	},
	// Download the plugin from the repository to the project directory
	Install: function(plugin_info) {
		if(!JavascriptLibrary.DirectoryExists(pluginsDir))
			JavascriptLibrary.MakeDirectory(pluginsDir, true);
		var pluginName = plugin_info.packageSlug;
		var pluginGitUrl = plugin_info.packageUrl;
		var gitProcess = JavascriptProcess.Create('git', 'clone ' + pluginGitUrl + ' ' + pluginName,
								true,	// bLaunchDetached
								true,	// bLaunchHidden
								false,	// bLaunchReallyHidden
								0,		// PriorityModifier
								pluginsDir, // WD
								true	// bUsePipe, was false before when working
		);
		return Promise.resolve({ 
			then: function(resolve, reject) {
				try {
					gitProcess.Wait();
					var code;
					var success = gitProcess.GetReturnCode(code);
					if(success) {
						var filePath = pluginsDir + pluginName + "/index.js";
						var pluginScript = installPlugin(filePath);
						installedPlugins[pluginName] = pluginScript;
						return resolve(code, plugin_info);
					} 
				} catch(e){
					console.error("Error: ", e);
				}

				return reject(code, plugin_info);
			}
		});

		if(pluginRealInfo) {
			var gitProcess = JavascriptProcess.Create('git', 'clone ' + pluginRealInfo.packageUrl + ' ' + pluginName,
									true,	// bLaunchDetached
									true,	// bLaunchHidden
									false,	// bLaunchReallyHidden
									0,		// PriorityModifier
									pluginsDir, // WD
									true	// bUsePipe, was false before when working
			);
			return Promise.resolve({ 
				then: function(resolve, reject) {
					try {
						gitProcess.Wait();
						var code;
						var success = gitProcess.GetReturnCode(code);
						if(success) {
							Context.RunFile(pluginsDir + pluginName + "/index.js");
							var pluginScript = GWorld.exports;
							installedPlugins[pluginName] = pluginScript;
							
							return resolve(code, plugin_info);
						} 
					} catch(e){
						console.error("Error: ", e);
					}

					return reject(code, plugin_info);
				}
			});
		}
		return false;
	},
	// Removes the plugin from the project directory
	UnInstall: function(plugin_info) {
		//	Create pluginJS directory if not exist
		if(!JavascriptLibrary.DirectoryExists(pluginsDir)){
			JavascriptLibrary.MakeDirectory(pluginsDir, true);
			console.log("Uninstall: Dir does not exist");
		}
		if(!(typeof plugin_info == "object")) return false;
		if (JavascriptLibrary.DirectoryExists(plugin_info.packageDir) &&
				JavascriptLibrary.DeleteDirectory(plugin_info.packageDir,true,true)) {
			return new Promise(function(resolve,reject) {
				delete installedPlugins[plugin_info.packageSlug];
				resolve();
			});
		} 
		return false;
	},
	IsValid: function(plugin_info) {
		if(!JavascriptLibrary.DirectoryExists(plugin_info.packageDir))
			return false;
		var pluginContent = Context.ReadDirectory(plugin_info.packageDir);
		var filesForValidPlugin = ['index.js'];
		for(var j in pluginContent.OutItems) {
			var fileIndex = filesForValidPlugin.indexOf(pluginContent.OutItems[j].Name.split("/").pop());
			if(fileIndex > -1)
				filesForValidPlugin.splice(fileIndex, 1);
		}
		return filesForValidPlugin.length == 0;
	},
	Instantiate: function(plugin_info, index, location, rotation) {
		if (typeof plugin_info === "string" )
			plugin_info = {packageSlug: plugin_info};
		index = index || 0;
		for (var i in installedPlugins) {
			if (i == plugin_info.packageSlug){
				var actors = installedPlugins[i].getPluginActors();
				try {
					if(typeof actors == "object" && index in actors) {
						var actor = actors[index];
						var actorInstance =  new actor.actor(GWorld, location, rotation);
						instantiatedPluginActors.push({
							meta: {
								plugin_info: plugin_info, 
								index: index
							}, 
							instance: actorInstance
						});
						return actorInstance;
					}
				} catch(e) {
					console.log(e, "Invalid object to instantiate");
				}
			}
		}
		return false;
	},
	Destroy: function(actor) {
		try {
			if(typeof actor == "object" && typeof actor.DestroyActor == "function") {
				for(var i = 0; i < instantiatedPluginActors.length; i++) {
					if(instantiatedPluginActors[i].instance === actor) {
						instantiatedPluginActors.splice(i, 1);
						i--; // TODO: Replace with break when we now that this works!
						break;
					}
				}
				if(typeof actor.Destroyed == "function")
					actor.Destroyed();
				actor.DestroyActor();
				return true;
			}
		}
		catch(e) {
						console.log("HEHEHEHEHEEH");
			return false;
		}
	}
};
function installPlugin(filePath) {

	Context.RunFile(filePath);
	var pluginScript = GWorld.exports;

	var actors = pluginScript.getPluginActors();
	for(var i in actors) {
		// Compile classes
		actors[i].actor = uclass(actors[i].actor);
	}
	return pluginScript;
}

/**
 * Search plugin folder after valid plugins and return the names of the plugins found
 * This will be executed when the file is required like the constructor
 */
var installedPlugins = {};
var installedPlugins = (function(){
	var plugins = {};
	var dirs = Context.ReadDirectory(pluginsDir);
	for(var i in dirs.OutItems) {
		var OutItem = dirs.OutItems[i];
		if(OutItem.bIsDirectory) {
			if(Plugin.IsValid({packageDir: OutItem.Name})) {
				var pathArr = OutItem.Name.split('/');
				plugins[OutItem.Name.split("/").pop()] = installPlugin(OutItem.Name + "/index.js");
			}
		}
	}
	return plugins;
})(undefined);

var availablePlugins = [];
Plugin.FetchList().then(function(plugins) {
	availablePlugins = plugins;
});

var instantiatedPluginActors = [];

/**
 * An object that is verified as a plugin and can be instantiated in the scene
 */
var PluginObject = function(plugin_info) {
	var self = this;
	try {
		const packageUrl = plugin_info.html_url;
		const packageSlug = plugin_info.full_name.toLowerCase();
		self.name 			= plugin_info.full_name.split('/', 2)[1]; // repo name
		self.packageUrl		= packageUrl;
		self.packageSlug	= packageSlug.replace(/\//gm, '_');
		self.packageDir		= pluginsDir + self.packageSlug;
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
	self.Instantiate = function(){
		return Plugin.Instantiate(self);
	}
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

/** NOT IN USE
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
*/
module.exports.getAvailablePluginList = function() {
	return availablePlugins;
};
module.exports.getInstalledPluginList = function() {
	return installedPlugins;
};
module.exports.getInstantiatedPluginActors = function() {
	return instantiatedPluginActors;
};

module.exports.Instantiate = Plugin.Instantiate;
module.exports.Install = Plugin.Install;
module.exports.UnInstall = Plugin.UnInstall;
module.exports.Destroy = Plugin.Destroy;
module.exports.GetPluginActors = Plugin.GetPluginActors;
module.exports.GetPluginByName = Plugin.GetPluginByName;
