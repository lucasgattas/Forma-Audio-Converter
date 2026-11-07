use super::*;

#[test]
fn destination_requires_a_live_selected_directory() {
    let destination = Destination::default();
    assert!(destination.path().is_err());
    let temp = tempfile::tempdir().unwrap();
    destination.select(temp.path()).unwrap();
    assert_eq!(destination.path().unwrap(), temp.path().canonicalize().unwrap());
    let file = temp.path().join("file");
    std::fs::write(&file, b"test").unwrap();
    assert!(destination.select(&file).is_err());
    assert!(destination.select(&temp.path().join("missing")).is_err());
    let other = tempfile::tempdir().unwrap();
    destination.select(other.path()).unwrap();
    assert_eq!(destination.path().unwrap(), other.path().canonicalize().unwrap());
    destination.select(temp.path()).unwrap();
    std::fs::remove_dir_all(temp.path()).unwrap();
    assert!(destination.path().is_err());
}

#[test]
fn opening_contract_does_not_expose_path_or_wildcard_permission() {
    let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    let permissions = capability["permissions"].as_array().unwrap();
    assert!(permissions.iter().all(|p| !p.to_string().contains("opener:")));
    let source = include_str!("main.rs");
    assert!(source.contains("fn open_destination(destination: State<'_, Destination>)"));
    assert!(source.contains("tauri_plugin_opener::open_path(path, None::<&str>)"));
}
