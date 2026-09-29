import UIKit
import Capacitor
import StoreKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class MainViewController: CAPBridgeViewController {
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SwarmStorePlugin())
    }
}

@objc(SwarmStorePlugin)
final class SwarmStorePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SwarmStorePlugin"
    let jsName = "SwarmStore"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise)
    ]

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map { product in
                    [
                        "id": product.id,
                        "name": product.displayName,
                        "description": product.description,
                        "displayPrice": product.displayPrice
                    ]
                }])
            } catch {
                call.reject("Ürün bilgileri App Store'dan alınamadı.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            return call.reject("productId gerekli.")
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    return call.reject("Ürün App Store'da bulunamadı.")
                }
                switch try await product.purchase() {
                case .success(let verification):
                    switch verification {
                    case .verified(let transaction):
                        call.resolve([
                            "productId": transaction.productID,
                            "transactionId": String(transaction.id),
                            "verificationResult": verification.jwsRepresentation
                        ])
                    case .unverified(_, let error):
                        call.reject("Satın alma doğrulanamadı.", nil, error)
                    }
                case .pending:
                    call.reject("Satın alma onay bekliyor.", "PURCHASE_PENDING")
                case .userCancelled:
                    call.reject("Satın alma iptal edildi.", "PURCHASE_CANCELLED")
                @unknown default:
                    call.reject("Satın alma tamamlanamadı.")
                }
            } catch {
                call.reject("Satın alma başlatılamadı.", nil, error)
            }
        }
    }

    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId"), let id = UInt64(transactionId) else {
            return call.reject("Geçerli transactionId gerekli.")
        }
        Task {
            for await verification in Transaction.unfinished {
                if case .verified(let transaction) = verification, transaction.id == id {
                    await transaction.finish()
                    return call.resolve()
                }
            }
            call.resolve()
        }
    }
}
